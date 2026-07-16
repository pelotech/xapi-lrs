/**
 * Database Connection Pool
 * Simple PostgreSQL connection pool for a single-tenant lrsql-compatible LRS.
 * No RLS, no tenant context, no role switching.
 */

import { context, trace, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { Pool } from 'pg';
import type { QueryConfig, QueryResult, QueryResultRow } from 'pg';

// ============================================================================
// Driver-agnostic pool interfaces
// ============================================================================

export interface DbClient {
  // Default to `any` to match pg's QueryResult<R = any> behavior
  query<R extends QueryResultRow = any>(config: QueryConfig): Promise<QueryResult<R>>;
  release(err?: Error | boolean | null): void;
}

export interface DbPool {
  connect(): Promise<DbClient>;
  query<R extends QueryResultRow = any>(config: QueryConfig): Promise<QueryResult<R>>;
  end(): Promise<void>;
}
import type { LrsConfig } from './config.ts';
import type { Logger } from './logger.ts';
import type { LrsMetrics } from './metrics.ts';
import { startTimer } from './metrics.ts';

// ============================================================================
// Pool creation
// ============================================================================

export async function createPool(config: LrsConfig, logger: Logger): Promise<DbPool> {
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
    // Cap per-statement runtime so a slow/runaway query can't tie up a pool
    // connection indefinitely. 0 disables the cap (PostgreSQL default).
    statement_timeout: config.pgStatementTimeoutMs || undefined,
    // Reclaim connections that sit idle inside a transaction (app held
    // BEGIN without COMMIT/ROLLBACK). 0 disables.
    idle_in_transaction_session_timeout: config.pgIdleInTransactionTimeoutMs || undefined,
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

// Set at bootstrap when tracing is enabled (see src/server.ts); default no-op.
let dbTracer: Tracer = trace.getTracer('xapi-lrs');
export function setDbTracer(t: Tracer): void {
  dbTracer = t;
}

/**
 * Wrap a query in a CLIENT span — but only inside a traced xAPI request
 * (there must be an active recording span). Admin-plane queries run the same
 * seams with no active span and emit nothing.
 */
function withDbSpan<T>(queryName: string, run: () => Promise<T>): Promise<T> {
  if (!trace.getActiveSpan()?.isRecording()) return run();
  const span = dbTracer.startSpan(`db.query ${queryName}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'db.system': 'postgresql', query_name: queryName },
  });
  return context.with(trace.setSpan(context.active(), span), () =>
    run().then(
      (res) => {
        span.end();
        return res;
      },
      (err: unknown) => {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw err;
      },
    ),
  );
}

function instrumentQuery(client: DbClient, metrics: LrsMetrics): DbClient {
  const originalQuery = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    const queryName = extractQueryName(args[0]);
    const end = startTimer(metrics.dbQueryDuration, { query_name: queryName });
    // Callback form: node-pg returns undefined and invokes the callback instead of
    // returning a promise. pg-pool calls pooled clients this way internally, and this
    // patch persists after a client is released back to the pool — so a later
    // pool.query() can invoke it callback-style. Pass it straight through (no span,
    // no `.then`) to avoid `Cannot read properties of undefined (reading 'then')`.
    if (typeof args[args.length - 1] === 'function') {
      const result = (originalQuery as Function)(...args);
      end();
      return result;
    }
    return withDbSpan(queryName, () => (originalQuery as Function)(...args)).then(
      (res: unknown) => {
        end();
        return res;
      },
      (error: unknown) => {
        end();
        throw error;
      },
    );
  }) as typeof client.query;
  return client;
}

// ============================================================================
// Client utilities
// ============================================================================

/** Execute a function within a BEGIN/COMMIT transaction. */
export async function withClient<T>(
  pool: DbPool,
  metrics: LrsMetrics,
  fn: (client: DbClient) => Promise<T>,
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
  pool: DbPool,
  metrics: LrsMetrics,
  config: QueryConfig,
): Promise<QueryResult<R>> {
  const end = startTimer(metrics.dbQueryDuration, { query_name: config.name ?? 'unknown' });
  try {
    return await withDbSpan(config.name ?? 'unknown', () => pool.query<R>(config));
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
