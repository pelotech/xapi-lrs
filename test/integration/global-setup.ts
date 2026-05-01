/**
 * Vitest Global Setup / Teardown for LRS integration tests.
 *
 * Creates the lrsql-compatible schema in the test database.
 */

import { createTestPool, applyLrsqlSchema, truncateLrsqlTables } from './test-db.ts';

export async function setup(): Promise<void> {
  const pool = createTestPool();
  try {
    await applyLrsqlSchema(pool);
    await truncateLrsqlTables(pool);
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  // Cleanup can be added later if needed
}
