/**
 * Vitest Global Setup / Teardown for LRS integration tests.
 *
 * Creates the lrsql-compatible schema in the test database.
 */

import { createTestPool, provisionSchema, truncateLrsqlTables } from './test-db.ts';

export async function setup(): Promise<void> {
  // PGlite provisions per-instance inside the test server (createPgliteBackend,
  // including the SCHEMA_SOURCE=lrsql takeover path) — no shared setup needed.
  if (process.env['DATABASE_DRIVER'] === 'pglite') return;

  const pool = createTestPool();
  try {
    // Honors SCHEMA_SOURCE: `lrsql` applies upstream DDL then the committed
    // migration on top (takeover); `migration` (default) applies it directly.
    await provisionSchema(pool);
    await truncateLrsqlTables(pool);
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  // Cleanup can be added later if needed
}
