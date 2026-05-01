/**
 * LRS Process Entrypoint
 * Starts the Hono HTTP server and admin server.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import type { LrsConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createMetrics } from "./metrics.ts";
import { createPool } from "./db.ts";
import { JwksCache, discoverJwksUri } from "./auth/jwt.ts";
import type { JwtConfig } from "./auth/jwt.ts";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PgListener } from "./sse/pg-listener.ts";
import { createApp } from "./app.ts";
import {
  hasAnyAdminAccount,
  ensureAdminAccount,
  createAccount,
  getAccountByUsername,
  ensureDefaultCredential,
} from "./admin/repositories/index.ts";
import { bootstrapAccounts } from "./bootstrap.ts";
import { runMigrations } from "./migrate.ts";
import type { Logger } from "pino";

async function initJwt(
  config: LrsConfig,
  logger: Logger,
  jwksCache: JwksCache,
): Promise<JwtConfig | null> {
  if (!config.jwtIssuer || !config.jwtAudience) return null;

  let jwksUri = config.jwksUri;
  if (!jwksUri && config.oidcDiscoveryUrl) {
    jwksUri = await discoverJwksUri(config.oidcDiscoveryUrl);
  }
  if (!jwksUri) {
    logger.warn(
      "JWT_ISSUER and JWT_AUDIENCE set but no JWKS_URI or OIDC_DISCOVERY_URL — JWT auth disabled",
    );
    return null;
  }

  const resolver = jwksCache.getKeyResolver(jwksUri);
  await resolver.reload().catch((err) => {
    logger.warn(err, "Failed to pre-warm JWKS cache");
  });
  logger.debug({ issuer: config.jwtIssuer }, "JWT authentication configured");

  return { issuer: config.jwtIssuer, audience: config.jwtAudience, jwksUri };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics();

  logger.info({ port: config.port, adminPort: config.adminPort }, "Starting LRS service");

  // Fail-fast config validation (no async deps)
  if (!config.adminSessionSecret && config.nodeEnv === "production") {
    throw new Error("ADMIN_SESSION_SECRET is required in production");
  }
  if (!config.adminSessionSecret) {
    logger.warn(
      "ADMIN_SESSION_SECRET not set — using random per-process secret (sessions will not survive restarts)",
    );
  }
  const sessionSecret = config.adminSessionSecret ?? randomBytes(32).toString("hex");

  if (config.corsEnabled && config.corsOrigin === "*" && config.nodeEnv === "production") {
    throw new Error(
      "CORS_ORIGIN must not be '*' in production — set it to your allowed origin(s), or set CORS_ENABLED=false if CORS is handled by a reverse proxy",
    );
  }

  // Optional: run graphile-migrate before starting
  if (config.autoMigrate) {
    const user = encodeURIComponent(config.pgUser);
    const pass = encodeURIComponent(config.pgPassword);
    const connectionString =
      config.databaseUrl ??
      `postgres://${user}:${pass}@${config.pgHost}:${config.pgPort}/${config.pgDatabase}`;
    logger.info("AUTO_MIGRATE=true — running migrations");
    await runMigrations(connectionString);
    logger.info("Migrations complete");
  }

  // Phase 1: concurrent initialization
  const jwksCache = new JwksCache();
  const pgListener = new PgListener(config, logger);

  const t0 = performance.now();

  const [pool, jwtConfig] = await Promise.all([
    createPool(config, logger),
    initJwt(config, logger, jwksCache),
    pgListener.start(),
  ]);

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

  // Hono app
  const startedAt = new Date();
  const app = createApp({
    config,
    pool,
    jwksCache,
    jwtConfig,
    metrics,
    logger,
    pgListener,
    sessionSecret,
    startedAt,
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
  logger.info({ routes }, "routes");

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    logger.info({ port: config.port }, "LRS HTTP server listening");
  });

  // Admin server (health + metrics)
  // Security: this port exposes unauthenticated /healthz, /ready, and /metrics
  // endpoints. It MUST NOT be exposed to the public internet — restrict access
  // via network policy, firewall rules, or bind to a loopback/internal interface.
  const adminApp = new Hono();
  adminApp.get("/healthz", (c) => c.text("ok"));
  adminApp.get("/ready", async (c) => {
    try {
      await pool.query("SELECT 1");
      return c.text("ok");
    } catch {
      return c.text("database unavailable", 503);
    }
  });
  adminApp.get("/metrics", async (c) => {
    const content = await metrics.getPrometheusText();
    return c.text(content, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });
  const adminServer = serve({ fetch: adminApp.fetch, port: config.adminPort }, () => {
    logger.info({ port: config.adminPort }, "LRS admin server listening");
  });

  const tReady = performance.now();
  logger.debug(
    {
      parallelMs: Math.round(tParallel - t0),
      adminMs: Math.round(tAdmin - tParallel),
      appMs: Math.round(tReady - tAdmin),
      totalMs: Math.round(tReady - t0),
    },
    "Startup timing",
  );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down LRS service");
    server.close();
    adminServer.close();
    await metrics.shutdown();
    await pgListener.stop();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting LRS:", err);
  process.exit(1);
});
