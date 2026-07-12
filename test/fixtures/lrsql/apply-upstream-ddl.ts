/**
 * Applies the vendored lrsql v0.9.5 Postgres DDL (test/fixtures/lrsql/ddl-v0.9.5.sql,
 * verbatim from yetanalytics/lrsql @ v0.9.5) the way lrsql itself would: one
 * HugSQL block at a time, in order. Provisions a database indistinguishable
 * from a fresh, fully-migrated lrsql install (verified by schema-parity.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PGlite satisfies this natively; for pg use { exec: (t) => pool.query(t) }. */
export interface ExecRunner {
  exec(text: string): Promise<unknown>;
}

export function upstreamDdlBlocks(): string[] {
  const raw = readFileSync(join(import.meta.dirname, 'ddl-v0.9.5.sql'), 'utf8');
  const parts = raw.split(/^(?=-- :name )/m);
  // parts[0] is the file header before the first block marker
  return parts.slice(1).map((block) => block.replaceAll(':sql:tz-id', `'UTC'`));
}

export async function applyUpstreamLrsqlDdl(runner: ExecRunner): Promise<void> {
  for (const block of upstreamDdlBlocks()) {
    await runner.exec(block);
  }
}
