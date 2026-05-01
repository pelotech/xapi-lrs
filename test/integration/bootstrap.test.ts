import { describe, test, expect, beforeEach } from 'vitest';
import { createTestPool, truncateLrsqlTables } from './test-db.ts';
import { createMetrics } from '../../src/metrics.ts';
import { hasAnyAdminAccount, createAccount } from '../../src/admin/repositories/accounts.ts';
import { ensureDefaultCredential, listCredentials } from '../../src/admin/repositories/credentials.ts';

const pool = createTestPool();
const metrics = createMetrics();

beforeEach(async () => {
  await truncateLrsqlTables(pool);
});

// ---------------------------------------------------------------------------
// hasAnyAdminAccount
// ---------------------------------------------------------------------------

describe('hasAnyAdminAccount', () => {
  test('returns false when the table is empty', async () => {
    expect(await hasAnyAdminAccount(pool, metrics)).toBe(false);
  });

  test('returns true after an account is created', async () => {
    await createAccount(pool, metrics, 'alice', 'password');
    expect(await hasAnyAdminAccount(pool, metrics)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureDefaultCredential
// ---------------------------------------------------------------------------

describe('ensureDefaultCredential', () => {
  test("creates the credential with 'all' scope when absent", async () => {
    const accountId = await createAccount(pool, metrics, 'admin', 'password');
    await ensureDefaultCredential(pool, metrics, 'my_key', 'my_secret', accountId);

    const creds = await listCredentials(pool, metrics);
    expect(creds).toHaveLength(1);
    expect(creds[0].api_key).toBe('my_key');
    expect(creds[0].scopes).toContain('all');
  });

  test('is idempotent — does not create a duplicate on second call', async () => {
    const accountId = await createAccount(pool, metrics, 'admin', 'password');
    await ensureDefaultCredential(pool, metrics, 'my_key', 'my_secret', accountId);
    await ensureDefaultCredential(pool, metrics, 'my_key', 'my_secret', accountId);

    const creds = await listCredentials(pool, metrics);
    expect(creds).toHaveLength(1);
  });

  test('does not overwrite a pre-existing credential with a different secret', async () => {
    const accountId = await createAccount(pool, metrics, 'admin', 'password');
    await ensureDefaultCredential(pool, metrics, 'my_key', 'original_secret', accountId);
    await ensureDefaultCredential(pool, metrics, 'my_key', 'new_secret', accountId);

    const creds = await listCredentials(pool, metrics);
    expect(creds).toHaveLength(1);
  });
});
