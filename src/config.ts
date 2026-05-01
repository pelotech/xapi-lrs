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

  /** Bootstrap xAPI credential (created at startup if absent) */
  apiKeyDefault: z.string().optional(),
  apiSecretDefault: z.string().optional(),

  /** Run graphile-migrate before the server starts */
  autoMigrate: z.preprocess((v) => String(v ?? 'false') === 'true', z.boolean()).default(false),

  /** Request body size limit (bytes, default 50 MB) */
  maxRequestBodyBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),

  /** CORS — disable when handled by reverse proxy */
  corsEnabled: z.preprocess((v) => String(v ?? 'true') === 'true', z.boolean()).default(true),
  /** CORS allowed origin (only used when corsEnabled=true) */
  corsOrigin: z.string().default('*'),

  /** SSE connection limits */
  sseMaxConnectionsGlobal: z.coerce.number().int().positive().default(100),
  sseMaxConnectionsPerIp: z.coerce.number().int().positive().default(5),

  /** Number of trusted reverse proxy hops for X-Forwarded-For (0 = trust leftmost) */
  trustedProxyHops: z.coerce.number().int().nonnegative().default(0),

  /** xAPI rate limiting (requests per window per credential/IP) */
  xapiRateLimitWindow: z.coerce.number().int().positive().default(60),
  xapiRateLimitMax: z.coerce.number().int().positive().default(300),

  /** Feature flags */
  xapiVerifySignatures: z.preprocess((v) => String(v ?? 'true') === 'true', z.boolean()).default(true),

  /** Log level */
  logLevel: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Node environment */
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type LrsConfig = z.infer<typeof configSchema>;

// LRSQL uses Java log4j level names; normalize to pino equivalents.
function normalizeLrsqlLogLevel(level: string): string {
  switch (level.toUpperCase()) {
    case 'ALL':
    case 'TRACE':
      return 'trace';
    case 'DEBUG':
      return 'debug';
    case 'INFO':
      return 'info';
    case 'WARN':
      return 'warn';
    case 'ERROR':
      return 'error';
    case 'FATAL':
      return 'fatal';
    case 'OFF':
      return 'silent';
    default:
      return level.toLowerCase();
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): LrsConfig {
  // LRSQL_ALLOW_ALL_ORIGINS=true is equivalent to CORS_ORIGIN=* + CORS_ENABLED=true
  const lrsqlAllowAll = env.LRSQL_ALLOW_ALL_ORIGINS === 'true';

  const lrsqlLogLevel = env.LRSQL_LOG_LEVEL ? normalizeLrsqlLogLevel(env.LRSQL_LOG_LEVEL) : undefined;

  const config = configSchema.parse({
    port: env.LRS_PORT ?? env.PORT,
    adminPort: env.LRS_ADMIN_PORT ?? env.ADMIN_PORT,
    databaseUrl: env.DATABASE_URL,
    pgHost: env.TEST_DB_HOST ?? env.PGHOST,
    pgPort: env.TEST_DB_PORT ?? env.PGPORT,
    pgDatabase: env.TEST_DB_NAME ?? env.PGDATABASE ?? env.LRSQL_DB_NAME,
    pgUser: env.TEST_DB_USER ?? env.PGUSER,
    pgPassword: env.TEST_DB_PASSWORD ?? env.PGPASSWORD,
    pgPoolSize: env.PG_POOL_SIZE,
    dbConnectRetries: env.DB_CONNECT_RETRIES,
    dbConnectRetryDelayMs: env.DB_CONNECT_RETRY_DELAY_MS,
    jwtIssuer: env.JWT_ISSUER ?? env.LRSQL_OIDC_ISSUER,
    jwtAudience: env.JWT_AUDIENCE ?? env.LRSQL_OIDC_AUDIENCE,
    oidcDiscoveryUrl: env.OIDC_DISCOVERY_URL,
    adminUser: env.LRS_ADMIN_USER ?? env.LRSQL_ADMIN_USER_DEFAULT,
    adminPassword: env.LRS_ADMIN_PASSWORD ?? env.LRSQL_ADMIN_PASS_DEFAULT,
    adminSessionSecret: env.ADMIN_SESSION_SECRET,
    apiKeyDefault: env.LRS_API_KEY_DEFAULT ?? env.LRSQL_API_KEY_DEFAULT,
    apiSecretDefault: env.LRS_API_SECRET_DEFAULT ?? env.LRSQL_API_SECRET_DEFAULT,
    autoMigrate: env.AUTO_MIGRATE,
    jwksUri: env.JWKS_URI,
    corsEnabled: env.CORS_ENABLED ?? (lrsqlAllowAll ? 'true' : undefined),
    corsOrigin: env.CORS_ORIGIN ?? (lrsqlAllowAll ? '*' : undefined),
    maxRequestBodyBytes: env.MAX_REQUEST_BODY_BYTES,
    sseMaxConnectionsGlobal: env.SSE_MAX_CONNECTIONS_GLOBAL,
    sseMaxConnectionsPerIp: env.SSE_MAX_CONNECTIONS_PER_IP,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    xapiRateLimitWindow: env.XAPI_RATE_LIMIT_WINDOW,
    xapiRateLimitMax: env.XAPI_RATE_LIMIT_MAX,
    xapiVerifySignatures: env.XAPI_VERIFY_SIGNATURES,
    logLevel: env.LOG_LEVEL ?? lrsqlLogLevel,
    nodeEnv: env.NODE_ENV,
  });

  if (!config.xapiVerifySignatures) {
    console.warn(
      'WARNING: XAPI_VERIFY_SIGNATURES is disabled — signed statements will be accepted without ' +
        'cryptographic verification. This means forged or tampered signatures will not be detected. ' +
        'Only disable this if you are certain no consumers rely on signature integrity.',
    );
  }

  return config;
}
