import { PGlite } from '@electric-sql/pglite';
import { describe, it, expect } from 'vitest';
import { applyUpstreamLrsqlDdl, upstreamDdlBlocks } from '../fixtures/lrsql/apply-upstream-ddl.ts';

describe('vendored lrsql DDL', () => {
  it('splits into the expected number of HugSQL blocks', () => {
    expect(upstreamDdlBlocks().length).toBe(49);
  });

  it('provisions a fresh database end to end', async () => {
    const db = new PGlite();
    await applyUpstreamLrsqlDdl(db);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    expect(rows[0].n).toBe(15);
    await db.close();
  });
});
