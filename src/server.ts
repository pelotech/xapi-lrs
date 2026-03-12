/**
 * LRS Process Entrypoint
 * Starts the Hono HTTP server and admin server.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createMetrics } from "./metrics.ts";
import { createPool } from "./db.ts";
import { JwksCache, discoverJwksUri } from "./auth/jwt.ts";
import type { JwtConfig } from "./auth/jwt.ts";
import { randomBytes } from "node:crypto";
import { PgListener } from "./sse/pg-listener.ts";
import { createApp } from "./app.ts";
import { ensureAdminAccount } from "./admin/repositories.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = createMetrics();

  logger.info({ port: config.port, adminPort: config.adminPort }, "Starting LRS service");

  // Database
  const pool = await createPool(config, logger);

  // JWKS cache + JWT config from env vars
  const jwksCache = new JwksCache();
  let jwtConfig: JwtConfig | null = null;

  if (config.jwtIssuer && config.jwtAudience) {
    let jwksUri = config.jwksUri;
    if (!jwksUri && config.oidcDiscoveryUrl) {
      jwksUri = await discoverJwksUri(config.oidcDiscoveryUrl);
    }
    if (jwksUri) {
      jwtConfig = {
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        jwksUri,
      };
      // Pre-warm the JWKS cache
      const resolver = jwksCache.getKeyResolver(jwksUri);
      await resolver.reload().catch((err) => {
        logger.warn(err, "Failed to pre-warm JWKS cache");
      });
      logger.info({ issuer: config.jwtIssuer }, "JWT authentication configured");
    } else {
      logger.warn(
        "JWT_ISSUER and JWT_AUDIENCE set but no JWKS_URI or OIDC_DISCOVERY_URL — JWT auth disabled",
      );
    }
  }

  // pg_notify listener for SSE
  const pgListener = new PgListener(config, logger);
  await pgListener.start();

  // Bootstrap admin account from env vars
  if (config.adminUser && config.adminPassword) {
    await ensureAdminAccount(pool, metrics, config.adminUser, config.adminPassword);
    logger.info({ username: config.adminUser }, "Admin account bootstrapped");
  }

  // Session secret: required in production, random fallback in dev
  if (!config.adminSessionSecret && config.nodeEnv === "production") {
    throw new Error("ADMIN_SESSION_SECRET is required in production");
  }
  if (!config.adminSessionSecret) {
    logger.warn(
      "ADMIN_SESSION_SECRET not set — using random per-process secret (sessions will not survive restarts)",
    );
  }
  const sessionSecret = config.adminSessionSecret ?? randomBytes(32).toString("hex");

  // CORS origin: wildcard is dangerous in production (only when app handles CORS)
  if (config.corsEnabled && config.corsOrigin === "*" && config.nodeEnv === "production") {
    throw new Error(
      "CORS_ORIGIN must not be '*' in production — set it to your allowed origin(s), or set CORS_ENABLED=false if CORS is handled by a reverse proxy",
    );
  }

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
