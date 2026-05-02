/**
 * PGlite adapter — implements DbPool/DbClient over @electric-sql/pglite.
 *
 * Limitations vs pg:
 * - Single connection: concurrent transactions interleave (operations are
 *   serialized by PGlite's internal queue, but share one implicit session).
 *   Fine for local-dev / low-concurrency use cases.
 * - No cross-process NOTIFY: use LocalListener (in-process db.listen) instead
 *   of PgListener for SSE.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { QueryConfig, QueryResult, QueryResultRow } from 'pg';
import type { LrsConfig } from './config.ts';
import type { DbClient, DbPool } from './db.ts';

// ============================================================================
// Result mapping
// ============================================================================

// PGlite returns bytea columns as Uint8Array; coerce to Buffer so downstream
// code (which calls .toString('utf8'), Buffer.isBuffer(), etc.) works uniformly.
function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v;
  }
  return out;
}

function mapResult<R extends QueryResultRow>(raw: Awaited<ReturnType<PGlite['query']>>): QueryResult<R> {
  return {
    command: '',
    rowCount: raw.affectedRows ?? raw.rows.length,
    oid: 0,
    fields: raw.fields.map((f) => ({
      name: f.name,
      tableID: 0,
      columnID: 0,
      dataTypeID: f.dataTypeID,
      dataTypeSize: 0,
      dataTypeModifier: 0,
      format: 'text',
    })),
    rows: raw.rows.map((r) => coerceRow(r as Record<string, unknown>)) as R[],
  };
}

// ============================================================================
// DbClient adapter
// ============================================================================

class PgliteClient implements DbClient {
  constructor(private db: PGlite) {}

  async query<R extends QueryResultRow = QueryResultRow>(config: QueryConfig): Promise<QueryResult<R>> {
    const raw = await this.db.query<R>(config.text, (config.values ?? []) as unknown[]);
    return mapResult<R>(raw);
  }

  release(): void {}
}

// ============================================================================
// DbPool adapter
// ============================================================================

class PglitePool implements DbPool {
  private client: PgliteClient;

  constructor(readonly db: PGlite) {
    this.client = new PgliteClient(db);
  }

  async connect(): Promise<DbClient> {
    return this.client;
  }

  async query<R extends QueryResultRow = QueryResultRow>(config: QueryConfig): Promise<QueryResult<R>> {
    const raw = await this.db.query<R>(config.text, (config.values ?? []) as unknown[]);
    return mapResult<R>(raw);
  }

  async end(): Promise<void> {
    await this.db.close();
  }
}

// ============================================================================
// Schema migration
// ============================================================================

async function applyMigrations(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _pglite_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = new URL('../db/migrations/committed', import.meta.url).pathname;
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await db.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM _pglite_migrations WHERE filename = $1) AS exists',
      [file],
    );
    if (rows[0].exists) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO _pglite_migrations (filename) VALUES ($1)', [file]);
  }
}

// ============================================================================
// Factory
// ============================================================================

export interface PgliteBackend {
  pool: DbPool;
  db: PGlite;
}

export async function createPgliteBackend(config: LrsConfig): Promise<PgliteBackend> {
  const db = await PGlite.create({
    dataDir: config.pgliteDataDir,
    extensions: { pgcrypto },
  });

  await applyMigrations(db);

  return { pool: new PglitePool(db), db };
}
