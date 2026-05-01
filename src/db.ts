/**
 * Database Connection Pool
 * Simple PostgreSQL connection pool for a single-tenant lrsql-compatible LRS.
 * No RLS, no tenant context, no role switching.
 */

import { Pool } from 'pg';
import type { PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';
import type { LrsConfig } from './config.ts';
import type { Logger } from './logger.ts';
import type { LrsMetrics } from './metrics.ts';
import { startTimer } from './metrics.ts';

// ============================================================================
// Pool creation
// ============================================================================

export async function createPool(config: LrsConfig, logger: Logger): Promise<Pool> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    host: config.pgHost,
    port: config.pgPort,
    database: config.pgDatabase,
    user: config.pgUser,
    password: config.pgPassword,
    max: config.pgPoolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on('error', (err) => {
    logger.error(err, 'Unexpected database pool error');
  });

  for (let attempt = 1; attempt <= config.dbConnectRetries; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return pool;
    } catch {
      if (attempt < config.dbConnectRetries) {
        const delay = config.dbConnectRetryDelayMs * attempt;
        logger.warn(
          { attempt, maxRetries: config.dbConnectRetries, retryInMs: delay },
          'Database connection failed, retrying',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  await pool.end();
  throw new Error(`Failed to connect to the database after ${config.dbConnectRetries} attempts`);
}

// ============================================================================
// Static query definitions
// ============================================================================

type Query = Omit<QueryConfig, 'values'>;

const BEGIN = { name: 'begin', text: 'BEGIN' } as const satisfies Query;
const COMMIT = { name: 'commit', text: 'COMMIT' } as const satisfies Query;
const ROLLBACK = { name: 'rollback', text: 'ROLLBACK' } as const satisfies Query;

// ============================================================================
// Query instrumentation
// ============================================================================

function extractQueryName(arg: unknown): string {
  if (arg !== null && arg !== undefined && typeof arg === 'object' && 'name' in arg) {
    return (arg as { name: string }).name;
  }
  return 'unknown';
}

function instrumentQuery(client: PoolClient, metrics: LrsMetrics): PoolClient {
  const originalQuery = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    const queryName = extractQueryName(args[0]);
    const end = startTimer(metrics.dbQueryDuration, { query_name: queryName });
    const result = (originalQuery as Function)(...args);
    if (result && typeof result.then === 'function') {
      return result.then(
        (res: unknown) => {
          end();
          return res;
        },
        (error: unknown) => {
          end();
          throw error;
        },
      );
    }
    end();
    return result;
  }) as typeof client.query;
  return client;
}

// ============================================================================
// Client utilities
// ============================================================================

/** Execute a function within a BEGIN/COMMIT transaction. */
export async function withClient<T>(
  pool: Pool,
  metrics: LrsMetrics,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  instrumentQuery(client, metrics);

  try {
    await client.query(BEGIN);
    const result = await fn(client);
    await client.query(COMMIT);
    return result;
  } catch (error) {
    await client.query(ROLLBACK);
    throw error;
  } finally {
    client.release();
  }
}

export async function poolQuery<R extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  metrics: LrsMetrics,
  config: QueryConfig,
): Promise<QueryResult<R>> {
  const end = startTimer(metrics.dbQueryDuration, { query_name: config.name ?? 'unknown' });
  try {
    return await pool.query<R>(config);
  } finally {
    end();
  }
}

// ============================================================================
// HttpError
// ============================================================================

export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Parse a POST merge body — validates content-type and JSON structure. */
export function parseMergeBody(body: Buffer, contentType: string): Record<string, unknown> {
  if (!contentType.includes('application/json')) {
    throw new HttpError(400, 'POST merge requires application/json content type');
  }
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Request body must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}
