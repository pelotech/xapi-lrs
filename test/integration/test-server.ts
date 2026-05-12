/**
 * Test Server Utilities for LRS integration tests.
 *
 * Creates an LRS Hono app on an ephemeral port with lrsql-compatible schema.
 */

import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import pg from 'pg';
import { pino } from 'pino';
import { createApp } from '../../src/app.ts';
import type { AppDeps } from '../../src/app.ts';
import { JwksCache } from '../../src/auth/jwt.ts';
import type { JwtConfig } from '../../src/auth/jwt.ts';
import type { LrsConfig } from '../../src/config.ts';
import type { DbPool } from '../../src/db.ts';
import type { HonoEnv } from '../../src/hono-env.ts';
import type { Logger } from '../../src/logger.ts';
import { createMetrics } from '../../src/metrics.ts';
import { PgListener } from '../../src/sse/pg-listener.ts';
import type { Listener } from '../../src/sse/pg-listener.ts';
import { defaultTestDbConfig } from './test-db.ts';
import { startJwksServer, signTestJWT } from './test-jwks.ts';
import type { JwksServerHandle } from './test-jwks.ts';

const { Pool } = pg;

export interface LrsTestServerHandle {
  readonly app: OpenAPIHono<HonoEnv>;
  readonly server: Server;
  readonly apiUrl: string;
  readonly adminUrl: string;
  readonly jwksUrl: string;
  readonly pool: DbPool;
  readonly pgListener: Listener;
  readonly config: LrsConfig;
  readonly close: () => Promise<void>;
  readonly createToken: (payload: Record<string, unknown>) => Promise<string>;
}

export interface LrsTestServerOptions {
  xapiVerifySignatures?: boolean;
}

export async function createLrsTestServer(opts?: LrsTestServerOptions): Promise<LrsTestServerHandle> {
  const isPglite = process.env['DATABASE_DRIVER'] === 'pglite';
  const jwksServer: JwksServerHandle = await startJwksServer();

  const config: LrsConfig = {
    port: 0,
    adminPort: 0,
    pgHost: defaultTestDbConfig.host,
    pgPort: defaultTestDbConfig.port,
    pgDatabase: defaultTestDbConfig.database,
    pgUser: defaultTestDbConfig.user,
    pgPassword: defaultTestDbConfig.password,
    pgPoolSize: 5,
    dbConnectRetries: 1,
    dbConnectRetryDelayMs: 100,
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    oidcDiscoveryUrl: undefined,
    jwksUri: jwksServer.jwksUrl,
    corsEnabled: true,
    corsOrigin: '*',
    maxRequestBodyBytes: 50 * 1024 * 1024,
    sseMaxConnectionsGlobal: 100,
    sseMaxConnectionsPerIp: 5,
    xapiVerifySignatures: opts?.xapiVerifySignatures ?? false,
    trustedProxyHops: 0,
    xapiRateLimitWindow: 60,
    xapiRateLimitMax: 10000,
    stmtGetDefault: 50,
    stmtGetMax: 50,
    databaseDriver: isPglite ? 'pglite' : 'pg',
    pgliteDataDir: undefined,
    autoMigrate: false,
    logLevel: 'silent',
    nodeEnv: 'test',
  };

  const logger: Logger = pino({ level: 'silent' });
  const metrics = createMetrics();
  const jwksCache = new JwksCache();

  const jwtConfig: JwtConfig = {
    issuer: config.jwtIssuer!,
    audience: config.jwtAudience!,
    jwksUri: jwksServer.jwksUrl,
  };

  let pool: DbPool;
  let pgListener: Listener;

  if (isPglite) {
    const { createPgliteBackend } = await import('../../src/db-pglite.ts');
    const { LocalListener } = await import('../../src/sse/local-listener.ts');
    const backend = await createPgliteBackend(config);
    pool = backend.pool;
    pgListener = new LocalListener(backend.db);
  } else {
    pool = new Pool({
      host: config.pgHost,
      port: config.pgPort,
      database: config.pgDatabase,
      user: config.pgUser,
      password: config.pgPassword,
      max: config.pgPoolSize,
    }) as unknown as DbPool;
    pgListener = new PgListener(config, logger);
  }

  const deps: AppDeps = {
    config,
    pool,
    jwksCache,
    jwtConfig,
    metrics,
    logger,
    pgListener,
    sessionSecret: 'test-secret',
    startedAt: new Date(),
  };
  const app = createApp(deps);

  const server = await new Promise<Server>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s as unknown as Server));
    s.on('error', (err: NodeJS.ErrnoException) => reject(err));
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get LRS test server address');
  }

  const apiUrl = `http://localhost:${address.port}`;

  // Admin server (health/ready/metrics) — mirrors src/server.ts
  const adminApp = new Hono();
  adminApp.get('/healthz', (c) => c.text('ok'));
  adminApp.get('/ready', async (c) => {
    try {
      await pool.query({ text: 'SELECT 1' });
      return c.text('ok');
    } catch {
      return c.text('database unavailable', 503);
    }
  });
  adminApp.get('/metrics', async (c) => {
    const content = await metrics.getPrometheusText();
    return c.text(content, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  });

  const adminServer = await new Promise<Server>((resolve, reject) => {
    const s = serve({ fetch: adminApp.fetch, port: 0 }, () => resolve(s as unknown as Server));
    s.on('error', (err: NodeJS.ErrnoException) => reject(err));
  });

  const adminAddress = adminServer.address();
  if (!adminAddress || typeof adminAddress === 'string') {
    throw new Error('Failed to get LRS admin test server address');
  }
  const adminUrl = `http://localhost:${adminAddress.port}`;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => adminServer.close(() => resolve()));
    await metrics.shutdown();
    await pgListener.stop();
    await pool.end().catch(() => {}); // pool may already be ended by tests
    await jwksServer.close();
  };

  const createToken = async (payload: Record<string, unknown>): Promise<string> => {
    return signTestJWT({ aud: 'test-audience', ...payload });
  };

  return {
    app,
    server,
    apiUrl,
    adminUrl,
    jwksUrl: jwksServer.jwksUrl,
    pool,
    pgListener,
    config,
    close,
    createToken,
  };
}
