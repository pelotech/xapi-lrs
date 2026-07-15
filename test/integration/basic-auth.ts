/**
 * Basic Auth credential creation for xAPI tests.
 *
 * Vitest-independent: keep this file free of `vitest` imports so it stays
 * importable from standalone CLI scripts (e.g. test/conformance/run-adl-suite.ts).
 */

import { randomUUID } from 'node:crypto';
import type { DbPool } from '../../src/db.ts';

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
