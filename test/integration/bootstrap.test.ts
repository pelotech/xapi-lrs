import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { hasAnyAdminAccount, createAccount } from '../../src/admin/repositories/accounts.ts';
import { ensureDefaultCredential, listCredentials } from '../../src/admin/repositories/credentials.ts';
import { createMetrics } from '../../src/metrics.ts';
import { applyLrsqlSchema, createTestPool, defaultTestDbConfig } from './test-db.ts';

const { Pool } = pg;

// These tests require a real PostgreSQL connection — skip in PGlite mode.
const isPglite = process.env['DATABASE_DRIVER'] === 'pglite';

// Isolation: bootstrap's assertions are whole-table (e.g. "no admin account
// exists yet") and its beforeEach TRUNCATEs the account/credential tables.
// Every integration file shares ONE Postgres database, so running that against
// the shared `public` schema clobbers other files' file-scoped fixtures under
// parallel forks. Instead, this file provisions its OWN schema and pins the
// connection's search_path to it (public excluded), so the truncation and the
// emptiness assertions are fully contained. This is what lets vitest restore
// fileParallelism for the integration project.
const SCHEMA = 'bootstrap_isolated';

const pool = new Pool({
  host: defaultTestDbConfig.host,
  port: defaultTestDbConfig.port,
  database: defaultTestDbConfig.database,
  user: defaultTestDbConfig.user,
  password: defaultTestDbConfig.password,
  max: 5,
  // search_path excludes public so CREATE TABLE IF NOT EXISTS / to_regtype in
  // the migration resolve against (and populate) THIS schema, not the shared
  // public one.
  options: `-c search_path=${SCHEMA}`,
});
const metrics = createMetrics();

beforeAll(async () => {
  if (isPglite) return;
  // Reset the isolated schema from a public-search_path connection, then
  // provision the committed migration into it via the pinned pool.
  const admin = createTestPool();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  } finally {
    await admin.end();
  }
  await applyLrsqlSchema(pool);
});

afterAll(async () => {
  if (!isPglite) {
    const admin = createTestPool();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    } finally {
      await admin.end();
    }
  }
  await pool.end();
});

beforeEach(async () => {
  // Safe now that it's scoped to this file's own schema.
  if (!isPglite) {
    await pool.query(`TRUNCATE credential_to_scope, lrs_credential, admin_account CASCADE`);
  }
});

// ---------------------------------------------------------------------------
// hasAnyAdminAccount
// ---------------------------------------------------------------------------

describe.skipIf(isPglite)('hasAnyAdminAccount', () => {
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

describe.skipIf(isPglite)('ensureDefaultCredential', () => {
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
