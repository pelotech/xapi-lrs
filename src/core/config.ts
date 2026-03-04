import { z } from 'zod';

const stringBool = () =>
  z
    .string()
    .transform((s) => s === 'true' || s === '1')
    .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  API_PORT: z.coerce.number().min(0).max(65535).default(8180),
  ADMIN_PORT: z.coerce.number().min(0).max(65535).default(8190),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().positive().default(30_000),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('*')
    .transform((s) => s.split(',')),
  ENABLE_METRICS: stringBool().default(true),
  RUN_MODE: z.enum(['combined', 'api', 'worker']).default('combined'),
  APP_VERSION: z.string().default('local'),

  // PostgreSQL
  DATABASE_URL: z.string().url(),
  PG_POOL_SIZE: z.coerce.number().positive().default(20),

  // Asset storage
  ASSET_STORAGE_PATH: z.string().default('/data/assets'),
});

export type AppConfig = z.infer<typeof envSchema> & { logLevel: string };

export function parseConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  const data = result.data;
  const logLevel =
    data.LOG_LEVEL ?? (data.NODE_ENV === 'test' ? 'silent' : 'info');

  return Object.freeze({ ...data, logLevel }) as AppConfig;
}
