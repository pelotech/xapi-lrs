import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { QueryConfig, QueryResult, QueryResultRow } from 'pg';
import { describe, it, expect } from 'vitest';
import { probeSchema, SchemaProbeError } from '../../src/db-probe.ts';
import type { DbClient, DbPool } from '../../src/db.ts';
import { applyUpstreamLrsqlDdl } from '../fixtures/lrsql/apply-upstream-ddl.ts';

const COMMITTED_MIGRATION_PATH = join(import.meta.dirname, '../../db/migrations/committed/000001-lrsql-schema.sql');

// Minimal shape of pre-0.6 xapi-lrs: scopes keyed by credential_id (no
// api_key/secret_key composite key) and no registration column on statements.
const LEGACY_PRE_0_6_DDL = `
  CREATE TABLE credential_to_scope (
    id uuid,
    credential_id uuid,
    scope text
  );
  CREATE TABLE xapi_statement (
    id uuid,
    statement_id uuid,
    verb_iri text,
    is_voided bool,
    payload json,
    stored timestamptz
  );
`;

// "Unknown" shape: xapi_statement exists but lacks registration, and
// credential_to_scope has neither marker column (api_key nor credential_id).
const UNKNOWN_SHAPE_DDL = `
  CREATE TABLE xapi_statement (
    id uuid,
    statement_id uuid,
    verb_iri text,
    is_voided bool,
    payload json,
    stored timestamptz
  );
  CREATE TABLE credential_to_scope (
    id uuid,
    scope text
  );
`;

/** Minimal DbPool over a scratch PGlite instance, just enough for probeSchema(). */
function poolFor(db: PGlite): DbPool {
  const query = async <R extends QueryResultRow = QueryResultRow>(config: QueryConfig): Promise<QueryResult<R>> => {
    const raw = await db.query<R>(config.text, (config.values ?? []) as unknown[]);
    return raw as unknown as QueryResult<R>;
  };
  return {
    query,
    connect: async (): Promise<DbClient> => ({ query, release: () => {} }),
    end: async () => {
      await db.close();
    },
  };
}

describe('probeSchema', () => {
  it('passes on the current shape (committed migration, raw-applied)', async () => {
    const db = new PGlite();
    try {
      const migrationSql = readFileSync(COMMITTED_MIGRATION_PATH, 'utf8');
      await db.exec(migrationSql);
      await expect(probeSchema(poolFor(db))).resolves.toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it('passes on the lrsql shape, pre-takeover (upstream DDL only, no trigger migration)', async () => {
    const db = new PGlite();
    try {
      await applyUpstreamLrsqlDdl(db);
      await expect(probeSchema(poolFor(db))).resolves.toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it('throws a pre-0.6 error on the legacy xapi-lrs 0.5.x shape', async () => {
    const db = new PGlite();
    try {
      await db.exec(LEGACY_PRE_0_6_DDL);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(SchemaProbeError);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(/pre-0\.6/);
    } finally {
      await db.close();
    }
  });

  it('throws a "no xAPI schema" error with the migrate hint on an empty database', async () => {
    const db = new PGlite();
    try {
      await expect(probeSchema(poolFor(db))).rejects.toThrow(SchemaProbeError);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(/no xAPI schema/);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(/dist\/migrate\.js/);
    } finally {
      await db.close();
    }
  });

  it('throws a generic mismatch error on an unrecognized shape', async () => {
    const db = new PGlite();
    try {
      await db.exec(UNKNOWN_SHAPE_DDL);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(SchemaProbeError);
      await expect(probeSchema(poolFor(db))).rejects.toThrow(/does not match the lrsql/);
    } finally {
      await db.close();
    }
  });
});
