/**
 * Shared integration test fixtures using vitest's test.extend() API.
 *
 * Provides composable fixtures for the lrsql-compatible LRS:
 *   pool + server (file-scoped) -> credential-based auth (per-test)
 *
 * Usage:
 *   import { test, describe, expect } from './fixtures.ts';
 *
 *   test('example', async ({ pool, server, basicAuth, authToken }) => { ... });
 */

import { test as baseTest, describe, expect } from 'vitest';
import type { DbPool } from '../../src/db.ts';
import { createBasicAuth } from './basic-auth.ts';
import { createTestPool, truncateLrsqlTables } from './test-db.ts';
import { createLrsTestServer } from './test-server.ts';
import type { LrsTestServerHandle } from './test-server.ts';

export interface IntegrationFixtures {
  pool: DbPool;
  server: LrsTestServerHandle;
  /** Base64-encoded Basic Auth credentials (api_key:secret_key) */
  basicAuth: string;
  /** Bearer JWT token for the test OIDC provider */
  authToken: string;
}

export const test = baseTest.extend<IntegrationFixtures>({
  // Use the server's own pool — works for both pg and PGlite drivers.
  pool: [
    async ({ server }, use) => {
      await use(server.pool);
    },
    { scope: 'file' },
  ],

  server: [
    // oxlint-disable-next-line no-empty-pattern -- vitest fixture API requires {} for fixtures with no dependencies
    async ({}, use) => {
      const server = await createLrsTestServer();
      await use(server);
      await server.close();
    },
    { scope: 'file' },
  ],

  basicAuth: [
    async ({ pool }, use) => {
      const auth = await createBasicAuth(pool);
      await use(auth);
    },
    { scope: 'file' },
  ],

  authToken: async ({ server }, use) => {
    const token = await server.createToken({ sub: 'test-user', scope: 'all' });
    await use(token);
  },
});

export { createBasicAuth } from './basic-auth.ts';
export { describe, expect };
export { createLrsTestServer };
export type { LrsTestServerHandle };
export { createTestPool, truncateLrsqlTables };
