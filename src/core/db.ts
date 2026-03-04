import pg from 'pg';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';

export async function connectWithRetry(
  config: AppConfig,
  logger: Logger,
  maxRetries = 5,
  delayMs = 2000,
): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_SIZE,
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ attempt, maxRetries }, 'Connecting to PostgreSQL...');
      await pool.query('SELECT 1');
      logger.info('PostgreSQL connection established');
      return pool;
    } catch (err) {
      logger.warn({ attempt, err }, 'PostgreSQL connection failed, retrying...');
      if (attempt === maxRetries) {
        await pool.end();
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }

  throw new Error('Unreachable');
}
