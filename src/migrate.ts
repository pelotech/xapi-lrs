import { migrate } from 'graphile-migrate';
import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';

// Resolve migrations folder relative to this file so the path works whether
// running from src/ (tsx) or dist/ (compiled), since both sit one level above db/.
const MIGRATIONS_FOLDER = new URL('../db/migrations', import.meta.url).pathname;

export async function runMigrations(connectionString: string): Promise<void> {
  await migrate({ connectionString, migrationsFolder: MIGRATIONS_FOLDER });
}

function buildConnectionString(config: ReturnType<typeof loadConfig>): string {
  if (config.databaseUrl) return config.databaseUrl;
  const user = encodeURIComponent(config.pgUser);
  const pass = encodeURIComponent(config.pgPassword);
  return `postgres://${user}:${pass}@${config.pgHost}:${config.pgPort}/${config.pgDatabase}`;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const connectionString = buildConnectionString(config);

  logger.info({ migrationsFolder: MIGRATIONS_FOLDER }, 'Running database migrations');
  await runMigrations(connectionString);
  logger.info('Migrations complete');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
