/**
 * Test Server Utilities for LRS integration tests.
 *
 * Creates an LRS Hono app on an ephemeral port with lrsql-compatible schema.
 */

import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import pg from "pg";
import { pino } from "pino";
import { createApp } from "../../src/app.ts";
import type { AppDeps } from "../../src/app.ts";
import type { HonoEnv } from "../../src/hono-env.ts";
import type { LrsConfig } from "../../src/config.ts";
import { createMetrics } from "../../src/metrics.ts";
import { JwksCache } from "../../src/auth/jwt.ts";
import type { JwtConfig } from "../../src/auth/jwt.ts";
import { PgListener } from "../../src/sse/pg-listener.ts";
import type { Logger } from "../../src/logger.ts";
import { defaultTestDbConfig } from "./test-db.ts";
import { startJwksServer, signTestJWT } from "./test-jwks.ts";
import type { JwksServerHandle } from "./test-jwks.ts";

const { Pool } = pg;

export interface LrsTestServerHandle {
  readonly app: OpenAPIHono<HonoEnv>;
  readonly server: Server;
  readonly apiUrl: string;
  readonly jwksUrl: string;
  readonly pool: pg.Pool;
  readonly pgListener: PgListener;
  readonly config: LrsConfig;
  readonly close: () => Promise<void>;
  readonly createToken: (payload: Record<string, unknown>) => Promise<string>;
}

export interface LrsTestServerOptions {
  xapiVerifySignatures?: boolean;
}

export async function createLrsTestServer(
  opts?: LrsTestServerOptions,
): Promise<LrsTestServerHandle> {
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
    jwtIssuer: "test-issuer",
    jwtAudience: "test-audience",
    oidcDiscoveryUrl: undefined,
    jwksUri: jwksServer.jwksUrl,
    corsOrigin: "*",
    maxRequestBodyBytes: 50 * 1024 * 1024,
    sseMaxConnectionsGlobal: 100,
    sseMaxConnectionsPerIp: 5,
    xapiVerifySignatures: opts?.xapiVerifySignatures ?? false,
    logLevel: "silent",
    nodeEnv: "test",
  };

  const pool = new Pool({
    host: config.pgHost,
    port: config.pgPort,
    database: config.pgDatabase,
    user: config.pgUser,
    password: config.pgPassword,
    max: config.pgPoolSize,
  });

  const logger: Logger = pino({ level: "silent" });
  const metrics = createMetrics();
  const jwksCache = new JwksCache();

  const jwtConfig: JwtConfig = {
    issuer: config.jwtIssuer!,
    audience: config.jwtAudience!,
    jwksUri: jwksServer.jwksUrl,
  };

  const pgListener = new PgListener(config, logger);

  const deps: AppDeps = {
    config,
    pool,
    jwksCache,
    jwtConfig,
    metrics,
    logger,
    pgListener,
    sessionSecret: "test-secret",
    startedAt: new Date(),
  };
  const app = createApp(deps);

  const server = await new Promise<Server>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s as unknown as Server));
    s.on("error", (err: NodeJS.ErrnoException) => reject(err));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get LRS test server address");
  }

  const apiUrl = `http://localhost:${address.port}`;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await metrics.shutdown();
    await pgListener.stop();
    await pool.end();
    await jwksServer.close();
  };

  const createToken = async (payload: Record<string, unknown>): Promise<string> => {
    return signTestJWT({ aud: "test-audience", ...payload });
  };

  return {
    app,
    server,
    apiUrl,
    jwksUrl: jwksServer.jwksUrl,
    pool,
    pgListener,
    config,
    close,
    createToken,
  };
}
