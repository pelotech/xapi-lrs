/**
 * LRS Process Entrypoint
 * Starts the Hono HTTP server and admin server.
 */

import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import {
  hasAnyAdminAccount,
  ensureAdminAccount,
  createAccount,
  getAccountByUsername,
  ensureDefaultCredential,
} from './admin/repositories/index.ts';
import { createApp } from './app.ts';
import { JwksCache, discoverJwksUri } from './auth/jwt.ts';
import type { JwtConfig } from './auth/jwt.ts';
import { bootstrapAccounts } from './bootstrap.ts';
import { loadConfig } from './config.ts';
import type { LrsConfig } from './config.ts';
import { probeSchema, SchemaProbeError } from './db-probe.ts';
import { createPool } from './db.ts';
import type { DbPool } from './db.ts';
import { createLogger } from './logger.ts';
import { createMetrics } from './metrics.ts';
import { runMigrations } from './migrate.ts';
import { PgListener } from './sse/pg-listener.ts';
import type { Listener } from './sse/pg-listener.ts';

async function initJwt(config: LrsConfig, logger: Logger, jwksCache: JwksCache): Promise<JwtConfig | null> {
  if (!config.jwtIssuer || !config.jwtAudience) return null;

  let jwksUri = config.jwksUri;
  if (!jwksUri && config.oidcDiscoveryUrl) {
    jwksUri = await discoverJwksUri(config.oidcDiscoveryUrl);
  }
  if (!jwksUri) {
    logger.warn('JWT_ISSUER and JWT_AUDIENCE set but no JWKS_URI or OIDC_DISCOVERY_URL — JWT auth disabled');
    return null;
  }

  const resolver = jwksCache.getKeyResolver(jwksUri);
  await resolver.reload().catch((err) => {
    logger.warn(err, 'Failed to pre-warm JWKS cache');
  });
  logger.debug({ issuer: config.jwtIssuer }, 'JWT authentication configured');

  return { issuer: config.jwtIssuer, audience: config.jwtAudience, jwksUri };
}

// Verifies the connected database has the lrsql-shaped schema this release
// requires; a wrong-shape database (legacy pre-0.6, empty, or otherwise
// unrecognized) fails the boot immediately with an actionable message
// instead of surfacing as a runtime 500 on first authenticated request
// (field issue 1).
async function probeStartupSchema(pool: DbPool, logger: Logger): Promise<void> {
  try {
    await probeSchema(pool);
  } catch (err) {
    if (err instanceof SchemaProbeError) {
      logger.fatal(err, 'Startup schema probe failed');
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics();

  logger.info({ port: config.port, adminPort: config.adminPort }, 'Starting LRS service');

  // Fail-fast config validation (no async deps)
  if (!config.adminSessionSecret && config.nodeEnv === 'production') {
    throw new Error('ADMIN_SESSION_SECRET is required in production');
  }
  if (!config.adminSessionSecret) {
    logger.warn('ADMIN_SESSION_SECRET not set — using random per-process secret (sessions will not survive restarts)');
  }
  const sessionSecret = config.adminSessionSecret ?? randomBytes(32).toString('hex');

  if (config.corsEnabled && config.corsOrigin === '*' && config.nodeEnv === 'production') {
    throw new Error(
      "CORS_ORIGIN must not be '*' in production — set it to your allowed origin(s), or set CORS_ENABLED=false if CORS is handled by a reverse proxy",
    );
  }

  // Phase 1: concurrent initialization
  const jwksCache = new JwksCache();
  const t0 = performance.now();

  let pool: DbPool;
  let listener: Listener;
  let jwtConfig: JwtConfig | null;

  if (config.databaseDriver === 'pglite') {
    const { createPgliteBackend } = await import('./db-pglite.ts');
    const { LocalListener } = await import('./sse/local-listener.ts');
    logger.info({ dataDir: config.pgliteDataDir ?? 'in-memory' }, 'Using PGlite database driver');
    const [backend, jwt] = await Promise.all([createPgliteBackend(config), initJwt(config, logger, jwksCache)]);
    pool = backend.pool;
    listener = new LocalListener(backend.db);
    jwtConfig = jwt;

    // PGlite's internal migrations have already run by the time
    // createPgliteBackend() returns; probe right away so a wrong-shape
    // pre-existing data directory fails fast instead of surfacing as a
    // runtime 500 on first authenticated request.
    await probeStartupSchema(pool, logger);
  } else {
    // Optional: run graphile-migrate before starting (pg only)
    if (config.autoMigrate) {
      const user = encodeURIComponent(config.pgUser);
      const pass = encodeURIComponent(config.pgPassword);
      const connectionString =
        config.databaseUrl ?? `postgres://${user}:${pass}@${config.pgHost}:${config.pgPort}/${config.pgDatabase}`;
      logger.info('AUTO_MIGRATE=true — running migrations');
      await runMigrations(connectionString);
      logger.info('Migrations complete');
    }
    const pgListener = new PgListener(config, logger);
    listener = pgListener;
    const [pgPool, jwt] = await Promise.all([
      createPool(config, logger),
      initJwt(config, logger, jwksCache),
      pgListener.start(),
    ]);
    pool = pgPool;
    jwtConfig = jwt;

    // Migrations are either pre-applied by the operator or just ran above
    // via AUTO_MIGRATE; probe before touching the pool for anything else so
    // a wrong-shape database (field issue 1) fails fast with an actionable
    // message instead of a runtime 500 on first authenticated request.
    await probeStartupSchema(pool, logger);
  }

  const tParallel = performance.now();

  // Phase 2: depends on pool
  await bootstrapAccounts(pool, metrics, config, logger, {
    hasAnyAdminAccount,
    ensureAdminAccount,
    createAccount,
    getAccountByUsername,
    ensureDefaultCredential,
  });
  const tAdmin = performance.now();

  // AbortController fires on SIGTERM/SIGINT; long-lived handlers (SSE) watch it.
  const shutdownController = new AbortController();
  let shuttingDown = false;

  // Hono app
  const startedAt = new Date();
  const app = createApp({
    config,
    pool,
    jwksCache,
    jwtConfig,
    metrics,
    logger,
    pgListener: listener,
    sessionSecret,
    startedAt,
    shutdownSignal: shutdownController.signal,
  });

  // Log registered routes
  const seen = new Set<string>();
  const routes: Array<{ method: string; path: string }> = [];
  for (const r of app.routes) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: r.method, path: r.path });
  }
  logger.info({ routes }, 'routes');

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    logger.info({ port: config.port }, 'LRS HTTP server listening');
  });

  // Admin server (health + metrics)
  // Security: this port exposes unauthenticated /healthz, /readyz, /ready, and
  // /metrics endpoints. It MUST NOT be exposed to the public internet — restrict
  // access via network policy, firewall rules, or bind to a loopback/internal
  // interface.
  //
  // Probe semantics (k8s convention):
  //   /healthz — liveness: the process is alive. Always 200 unless deadlocked.
  //   /readyz  — readiness: the process can accept new traffic. 503 during
  //              startup deps unavailable, during shutdown, or if a downstream
  //              (DB, pg_notify) is unhealthy.
  //   /ready   — deprecated alias for /readyz, kept for backward compatibility.
  const readyz = async () => {
    if (shuttingDown) {
      return { ok: false, status: 503 as const, body: 'shutting down' };
    }
    try {
      await pool.query({ text: 'SELECT 1' });
    } catch {
      return { ok: false, status: 503 as const, body: 'database unavailable' };
    }
    if (!listener.isReady()) {
      return { ok: false, status: 503 as const, body: 'pg_notify listener not ready' };
    }
    return { ok: true, status: 200 as const, body: 'ok' };
  };
  const adminApp = new Hono();
  adminApp.get('/healthz', (c) => c.text('ok'));
  adminApp.get('/readyz', async (c) => {
    const r = await readyz();
    return c.text(r.body, r.status);
  });
  adminApp.get('/ready', async (c) => {
    const r = await readyz();
    return c.text(r.body, r.status);
  });
  adminApp.get('/metrics', async (c) => {
    const content = await metrics.getPrometheusText();
    return c.text(content, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  });
  const adminServer = serve({ fetch: adminApp.fetch, port: config.adminPort }, () => {
    logger.info({ port: config.adminPort }, 'LRS admin server listening');
  });

  const tReady = performance.now();
  logger.debug(
    {
      parallelMs: Math.round(tParallel - t0),
      adminMs: Math.round(tAdmin - tParallel),
      appMs: Math.round(tReady - tAdmin),
      totalMs: Math.round(tReady - t0),
    },
    'Startup timing',
  );

  // Graceful shutdown sequence:
  //  1. Flip `shuttingDown` so /readyz immediately returns 503 — load balancers
  //     stop routing new traffic.
  //  2. Abort the shutdown signal — SSE heartbeat loops exit and their streams
  //     close, releasing the HTTP connections holding the server open.
  //  3. Close the HTTP listeners; the close callbacks fire only after all
  //     in-flight requests have completed.
  //  4. Stop the pg_notify listener (frees its dedicated DB connection).
  //  5. Drain the pool (closes remaining DB connections).
  //  6. Shut down metrics.
  // A hard deadline (config.shutdownTimeoutMs) force-exits if any step hangs.
  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info({ signal, timeoutMs: config.shutdownTimeoutMs }, 'Shutdown initiated');

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: config.shutdownTimeoutMs }, 'Shutdown timed out; forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    shuttingDown = true;
    shutdownController.abort();

    try {
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => adminServer.close(() => resolve())),
      ]);
      await listener.stop();
      await pool.end();
      await metrics.shutdown();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal error starting LRS:', err);
  process.exit(1);
});
