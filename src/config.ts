/**
 * LRS Service Configuration
 * Environment-driven configuration with Zod validation.
 */

import { z } from 'zod';

const configSchema = z.object({
  /** Express port for xAPI endpoints */
  port: z.coerce.number().int().positive().default(8081),
  /** Admin port for health/ready/metrics */
  adminPort: z.coerce.number().int().positive().default(8091),

  /** PostgreSQL connection */
  databaseUrl: z.string().optional(),
  pgHost: z.string().default('localhost'),
  pgPort: z.coerce.number().int().positive().default(5432),
  pgDatabase: z.string().default('xapi_lrs'),
  pgUser: z.string().default('xapi_lrs'),
  pgPassword: z.string().default(''),
  pgPoolSize: z.coerce.number().int().positive().default(10),

  /** DB connection retry */
  dbConnectRetries: z.coerce.number().int().positive().default(5),
  dbConnectRetryDelayMs: z.coerce.number().int().positive().default(1000),

  /** JWT authentication (env-var configured) */
  jwtIssuer: z.string().optional(),
  jwtAudience: z.string().optional(),
  oidcDiscoveryUrl: z.string().optional(),
  jwksUri: z.string().optional(),

  /** Admin UI */
  adminUser: z.string().optional(),
  adminPassword: z.string().optional(),
  adminSessionSecret: z.string().optional(),

  /** Request body size limit (bytes, default 50 MB) */
  maxRequestBodyBytes: z.coerce.number().int().positive().default(50 * 1024 * 1024),

  /** CORS allowed origin (default '*' for xAPI spec compliance) */
  corsOrigin: z.string().default('*'),

  /** SSE connection limits */
  sseMaxConnectionsGlobal: z.coerce.number().int().positive().default(100),
  sseMaxConnectionsPerIp: z.coerce.number().int().positive().default(5),

  /** Feature flags */
  xapiVerifySignatures: z.preprocess((v) => String(v ?? 'false') === 'true', z.boolean()).default(false),

  /** Log level */
  logLevel: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Node environment */
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type LrsConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): LrsConfig {
  return configSchema.parse({
    port: env.LRS_PORT ?? env.PORT,
    adminPort: env.LRS_ADMIN_PORT ?? env.ADMIN_PORT,
    databaseUrl: env.DATABASE_URL,
    pgHost: env.TEST_DB_HOST ?? env.PGHOST,
    pgPort: env.TEST_DB_PORT ?? env.PGPORT,
    pgDatabase: env.TEST_DB_NAME ?? env.PGDATABASE,
    pgUser: env.TEST_DB_USER ?? env.PGUSER,
    pgPassword: env.TEST_DB_PASSWORD ?? env.PGPASSWORD,
    pgPoolSize: env.PG_POOL_SIZE,
    dbConnectRetries: env.DB_CONNECT_RETRIES,
    dbConnectRetryDelayMs: env.DB_CONNECT_RETRY_DELAY_MS,
    jwtIssuer: env.JWT_ISSUER,
    jwtAudience: env.JWT_AUDIENCE,
    oidcDiscoveryUrl: env.OIDC_DISCOVERY_URL,
    adminUser: env.LRS_ADMIN_USER,
    adminPassword: env.LRS_ADMIN_PASSWORD,
    adminSessionSecret: env.ADMIN_SESSION_SECRET,
    jwksUri: env.JWKS_URI,
    corsOrigin: env.CORS_ORIGIN,
    maxRequestBodyBytes: env.MAX_REQUEST_BODY_BYTES,
    sseMaxConnectionsGlobal: env.SSE_MAX_CONNECTIONS_GLOBAL,
    sseMaxConnectionsPerIp: env.SSE_MAX_CONNECTIONS_PER_IP,
    xapiVerifySignatures: env.XAPI_VERIFY_SIGNATURES,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
  });
}
