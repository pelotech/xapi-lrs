import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect } from 'vitest';
import { applyUpstreamLrsqlDdl, upstreamDdlBlocks } from '../fixtures/lrsql/apply-upstream-ddl.ts';

describe('vendored lrsql DDL', () => {
  it('splits into the expected number of HugSQL blocks', () => {
    expect(upstreamDdlBlocks().length).toBe(49);
  });

  it('provisions a fresh database end to end', async () => {
    const db = new PGlite();
    try {
      await applyUpstreamLrsqlDdl(db);
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.tables
         WHERE table_schema = 'public'`,
      );
      expect(rows[0].n).toBe(15);
    } finally {
      await db.close();
    }
  });
});

// ============================================================================
// Catalog parity: migration-built schema vs upstream-lrsql-built schema
// ============================================================================

const COMMITTED_MIGRATION_PATH = join(import.meta.dirname, '../../db/migrations/committed/000001-lrsql-schema.sql');

interface CatalogRow {
  kind: string;
  name: string;
  pos: string;
  detail: string | null;
}

// Columns, constraints, indexes, and enum labels across the whole `public`
// schema, unioned into one comparable shape. Triggers/functions are
// deliberately NOT selected here — they're the one intentional divergence
// (our SSE trigger) and are asserted separately below.
const CATALOG_SQL = `
  SELECT 'column' AS kind,
         table_name || '.' || column_name AS name,
         ordinal_position::text AS pos,
         concat_ws('|', data_type, character_maximum_length, is_nullable, column_default) AS detail
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, '',
         pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index', schemaname || '.' || indexname, '', indexdef
    FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'enum', t.typname, e.enumsortorder::text, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typnamespace = 'public'::regnamespace
  ORDER BY 1, 2, 3, 4
`;

async function catalogSnapshot(db: PGlite): Promise<CatalogRow[]> {
  const { rows } = await db.query<CatalogRow>(CATALOG_SQL);
  // Re-sort defensively in JS (in addition to the SQL ORDER BY) so a failure
  // renders as a clean, position-independent unified diff via toEqual.
  return [...rows].sort((a, b) => {
    for (const key of ['kind', 'name', 'pos', 'detail'] as const) {
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });
}

async function migrationsTableExists(db: PGlite): Promise<boolean> {
  const {
    rows: [row],
  } = await db.query<{ exists: boolean }>(`SELECT to_regclass('public._pglite_migrations') IS NOT NULL AS exists`);
  return row.exists;
}

async function triggerNames(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'xapi_statement'::regclass AND NOT tgisinternal
      ORDER BY tgname`,
  );
  return rows.map((r) => r.tgname);
}

describe('schema parity: migration-built vs upstream-lrsql-built', () => {
  it('produces an identical catalog, modulo the documented SSE-trigger exception', async () => {
    const migrationDb = new PGlite();
    const upstreamDb = new PGlite();
    try {
      // Migration-built: raw-execute the committed migration file, exactly
      // like src/db-pglite.ts's inner `db.exec(sql)` step — but WITHOUT its
      // `_pglite_migrations` tracking wrapper, since that table is an
      // artifact of the pglite backend's own bookkeeping, not part of the
      // schema lrsql (or a real Postgres migration run) would produce.
      const migrationSql = readFileSync(COMMITTED_MIGRATION_PATH, 'utf8');
      await migrationDb.exec(migrationSql);

      // Upstream-built: provision via the HugSQL-aware executor, simulating
      // a live lrsql v0.9.5 install.
      await applyUpstreamLrsqlDdl(upstreamDb);

      // Parity exception 1: the pglite migration tracker table must be
      // absent from BOTH databases — raw provisioning bypasses it entirely,
      // so its presence in either build would itself be a bug.
      expect(await migrationsTableExists(migrationDb)).toBe(false);
      expect(await migrationsTableExists(upstreamDb)).toBe(false);

      // Parity exception 2: our SSE trigger. Triggers aren't selected by
      // CATALOG_SQL, so assert them out-of-band: exactly one trigger named
      // trg_xapi_statement_stored on xapi_statement in the migration-built
      // DB, and zero triggers on xapi_statement in the upstream-built DB.
      expect(await triggerNames(migrationDb)).toEqual(['trg_xapi_statement_stored']);
      expect(await triggerNames(upstreamDb)).toEqual([]);

      // The trigger's backing function likewise never appears in a catalog
      // query that only selects columns/constraints/indexes/enums; confirm
      // it exists in the migration-built DB as a sanity check.
      const {
        rows: [fnRow],
      } = await migrationDb.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_xapi_statement_stored') AS exists`,
      );
      expect(fnRow.exists).toBe(true);

      // Everything else — every table, column, constraint, index, and enum
      // label — must match exactly. Sorting both lists (already done by
      // catalogSnapshot) and comparing with toEqual gives a readable
      // unified diff if the migration ever drifts from upstream.
      const migrationSnapshot = await catalogSnapshot(migrationDb);
      const upstreamSnapshot = await catalogSnapshot(upstreamDb);
      expect(migrationSnapshot).toEqual(upstreamSnapshot);
    } finally {
      await migrationDb.close();
      await upstreamDb.close();
    }
  });
});
