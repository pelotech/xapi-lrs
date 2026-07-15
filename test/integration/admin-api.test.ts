/**
 * Integration tests for the admin REST API (/api/admin/credentials/*).
 */

import { randomUUID } from 'node:crypto';
import type { DbPool } from '../../src/db.ts';
import { hashPassword } from '../../src/helpers/passwords.ts';
import { test, describe, expect } from './fixtures.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Required by the xAPI spec (§3.2); not needed for admin API routes
const XAPI_HEADERS = { 'X-Experience-API-Version': '1.0.3' } as const;

/**
 * Insert an admin_account with a known password, hashed app-side with bcryptjs.
 * Returns the Base64-encoded "username:password" string for use as a Basic Auth header value.
 */
async function createAdminAuth(pool: DbPool, opts: { username?: string; password?: string } = {}): Promise<string> {
  const username = opts.username ?? `admin-${randomUUID().slice(0, 8)}`;
  const password = opts.password ?? randomUUID();
  await pool.query({
    text: `INSERT INTO admin_account (id, username, passhash) VALUES (gen_random_uuid(), $1, $2)`,
    values: [username, await hashPassword(password)],
  });
  return Buffer.from(`${username}:${password}`).toString('base64');
}

// ---------------------------------------------------------------------------
// Auth guard — every endpoint must enforce Basic Auth
// ---------------------------------------------------------------------------

const ALL_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/admin/credentials' },
  { method: 'GET', path: '/api/admin/credentials/some-id' },
  { method: 'POST', path: '/api/admin/credentials' },
  { method: 'DELETE', path: '/api/admin/credentials/some-id' },
  { method: 'PUT', path: '/api/admin/credentials/some-id/scopes' },
  { method: 'POST', path: '/api/admin/credentials/some-id/rotate' },
];

describe('Admin API — auth guard', () => {
  test('all endpoints return 401 with no Authorization header', async ({ server }) => {
    for (const { method, path } of ALL_ENDPOINTS) {
      const res = await fetch(`${server.apiUrl}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.headers.get('WWW-Authenticate'), `${method} ${path}`).toContain('Basic');
    }
  });

  test('all endpoints return 401 with wrong password', async ({ server, pool }) => {
    const username = `admin-${randomUUID().slice(0, 8)}`;
    await pool.query({
      text: `INSERT INTO admin_account (id, username, passhash) VALUES (gen_random_uuid(), $1, $2)`,
      values: [username, await hashPassword('correct-password')],
    });
    const wrongAuth = `Basic ${Buffer.from(`${username}:wrong-password`).toString('base64')}`;

    for (const { method, path } of ALL_ENDPOINTS) {
      const res = await fetch(`${server.apiUrl}${path}`, {
        method,
        headers: { Authorization: wrongAuth },
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  test('valid credentials pass the auth guard', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /credentials — secret_key is shown at creation and omitted from list
// ---------------------------------------------------------------------------

describe('Admin API — POST /credentials', () => {
  test('create response includes secret_key; GET /credentials does not', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const authHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };

    const createRes = await fetch(`${server.apiUrl}/api/admin/credentials`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ scopes: ['all'] }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created).toHaveProperty('id');
    expect(created).toHaveProperty('api_key');
    expect(created).toHaveProperty('secret_key');
    expect(created).toHaveProperty('scopes');

    // The list endpoint must never expose secret_key
    const listRes = await fetch(`${server.apiUrl}/api/admin/credentials`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<Record<string, unknown>>;
    for (const item of list) {
      expect(item).not.toHaveProperty('secret_key');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /credentials?api_key=… — filter the list by public api_key
// ---------------------------------------------------------------------------

describe('Admin API — GET /credentials?api_key', () => {
  test('returns only the matching credential and never leaks secret_key', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const adminHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };
    const base = `${server.apiUrl}/api/admin`;

    // Two credentials so we can confirm the filter actually filters
    const targetRes = await fetch(`${base}/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['statements/read'] }),
    });
    expect(targetRes.status).toBe(201);
    const target = (await targetRes.json()) as { id: string; api_key: string };

    const otherRes = await fetch(`${base}/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['all'] }),
    });
    expect(otherRes.status).toBe(201);

    const filterRes = await fetch(`${base}/credentials?api_key=${encodeURIComponent(target.api_key)}`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(filterRes.status).toBe(200);
    const list = (await filterRes.json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: target.id, api_key: target.api_key, scopes: ['statements/read'] });
    expect(list[0]).not.toHaveProperty('secret_key');
  });

  test('returns an empty array for an unknown api_key', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials?api_key=does-not-exist`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /credentials/:id — single-credential lookup; no secret_key
// ---------------------------------------------------------------------------

describe('Admin API — GET /credentials/:id', () => {
  test('returns the credential without secret_key', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const adminHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };
    const base = `${server.apiUrl}/api/admin`;

    const createRes = await fetch(`${base}/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['statements/read'] }),
    });
    expect(createRes.status).toBe(201);
    const { id, api_key } = (await createRes.json()) as { id: string; api_key: string };

    const getRes = await fetch(`${base}/credentials/${id}`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body).toEqual({ id, api_key, scopes: ['statements/read'] });
    expect(body).not.toHaveProperty('secret_key');
  });

  test('returns 404 for a non-existent credential', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials/${randomUUID()}`, {
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /credentials/:id/scopes — replaces, not appends
// ---------------------------------------------------------------------------

describe('Admin API — PUT /credentials/:id/scopes', () => {
  test('replaces all existing scopes with the new set', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const adminHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };
    const base = `${server.apiUrl}/api/admin`;

    const createRes = await fetch(`${base}/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['all'] }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    const putRes = await fetch(`${base}/credentials/${id}/scopes`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['statements/read'] }),
    });
    expect(putRes.status).toBe(200);
    expect(((await putRes.json()) as { scopes: string[] }).scopes).toEqual(['statements/read']);

    const listRes = await fetch(`${base}/credentials`, { headers: { Authorization: `Basic ${adminAuth}` } });
    const list = (await listRes.json()) as Array<{ id: string; scopes: string[] }>;
    const cred = list.find((c) => c.id === id);
    expect(cred?.scopes).toEqual(['statements/read']);
  });

  test('returns 404 for a non-existent credential', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials/${randomUUID()}/scopes`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopes: [] }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /credentials/:id — revokes xAPI access
// ---------------------------------------------------------------------------

describe('Admin API — DELETE /credentials/:id', () => {
  test('deleting a credential revokes xAPI access', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const adminHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };

    // Create a credential via the admin API
    const createRes = await fetch(`${server.apiUrl}/api/admin/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['all'] }),
    });
    expect(createRes.status).toBe(201);
    const { id, api_key, secret_key } = (await createRes.json()) as {
      id: string;
      api_key: string;
      secret_key: string;
    };
    const xapiAuth = `Basic ${Buffer.from(`${api_key}:${secret_key}`).toString('base64')}`;

    // Confirm the credential works for xAPI
    const beforeRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: xapiAuth, ...XAPI_HEADERS },
    });
    expect(beforeRes.status).toBe(200);

    // Delete via admin API
    const deleteRes = await fetch(`${server.apiUrl}/api/admin/credentials/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(deleteRes.status).toBe(204);

    // xAPI access with the deleted credential must now fail
    const afterRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: xapiAuth, ...XAPI_HEADERS },
    });
    expect(afterRes.status).toBe(401);
  });

  test('returns 404 for a non-existent credential', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials/${randomUUID()}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /credentials/:id/rotate — old key fails, new key works
// ---------------------------------------------------------------------------

describe('Admin API — POST /credentials/:id/rotate', () => {
  test('rotating a secret invalidates the old key and activates the new one', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const adminHeaders = { Authorization: `Basic ${adminAuth}`, 'Content-Type': 'application/json' };

    // Create a credential via the admin API
    const createRes = await fetch(`${server.apiUrl}/api/admin/credentials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scopes: ['all'] }),
    });
    expect(createRes.status).toBe(201);
    const {
      id,
      api_key,
      secret_key: oldSecret,
    } = (await createRes.json()) as {
      id: string;
      api_key: string;
      secret_key: string;
    };
    const oldXapiAuth = `Basic ${Buffer.from(`${api_key}:${oldSecret}`).toString('base64')}`;

    // Confirm the original secret works for xAPI
    const beforeRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: oldXapiAuth, ...XAPI_HEADERS },
    });
    expect(beforeRes.status).toBe(200);

    // Rotate the secret
    const rotateRes = await fetch(`${server.apiUrl}/api/admin/credentials/${id}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(rotateRes.status).toBe(200);
    const { secret_key: newSecret } = (await rotateRes.json()) as { secret_key: string };
    expect(newSecret).not.toBe(oldSecret);

    // Old secret must no longer authenticate xAPI requests
    const oldAfterRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: oldXapiAuth, ...XAPI_HEADERS },
    });
    expect(oldAfterRes.status).toBe(401);

    // New secret must authenticate xAPI requests
    const newXapiAuth = `Basic ${Buffer.from(`${api_key}:${newSecret}`).toString('base64')}`;
    const newAfterRes = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: newXapiAuth, ...XAPI_HEADERS },
    });
    expect(newAfterRes.status).toBe(200);
  });

  test('returns 404 for a non-existent credential', async ({ server, pool }) => {
    const adminAuth = await createAdminAuth(pool);
    const res = await fetch(`${server.apiUrl}/api/admin/credentials/${randomUUID()}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Basic ${adminAuth}` },
    });
    expect(res.status).toBe(404);
  });
});
