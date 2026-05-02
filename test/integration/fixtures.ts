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

import { randomUUID } from 'node:crypto';
import { test as baseTest, describe, expect } from 'vitest';
import type { DbPool } from '../../src/db.ts';
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

/**
 * Create Basic Auth credentials for xAPI authentication.
 * Inserts an admin_account, lrs_credential, and credential_to_scope rows.
 * Returns the Base64-encoded api_key:secret_key string.
 */
export async function createBasicAuth(pool: DbPool, opts: { scopes?: string[]; label?: string } = {}): Promise<string> {
  const accountId = randomUUID();
  const credentialId = randomUUID();
  const apiKey = randomUUID();
  const secretKey = randomUUID();
  const scopes = opts.scopes ?? ['all'];

  await pool.query({
    text: `INSERT INTO admin_account (id, username, passhash) VALUES ($1, $2, 'test')`,
    values: [accountId, opts.label ?? `test-${apiKey.slice(0, 8)}`],
  });

  await pool.query({
    text: `INSERT INTO lrs_credential (id, api_key, secret_key, account_id) VALUES ($1, $2, $3, $4)`,
    values: [credentialId, apiKey, secretKey, accountId],
  });

  for (const scope of scopes) {
    await pool.query({
      text: `INSERT INTO credential_to_scope (credential_id, scope) VALUES ($1, $2::scope_enum)`,
      values: [credentialId, scope],
    });
  }

  return Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
}

export { describe, expect };
export { createLrsTestServer };
export type { LrsTestServerHandle };
export { createTestPool, truncateLrsqlTables };
