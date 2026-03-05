/**
 * End-to-end token management tests against a real PostgreSQL database.
 *
 * Verifies the full round-trip:
 *   create token (admin) → use token (xAPI Basic Auth) → delete token → auth fails
 *
 * Each test creates its own tenant for isolation via RLS policies.
 *
 * Requires DATABASE_URL to point to a running PostgreSQL instance
 * with all migrations applied (including pgcrypto + private schema).
 *
 * RLS enforcement: The Docker dev setup creates `lrs` as a superuser,
 * which bypasses RLS. This suite revokes superuser before tests and
 * restores it afterwards so that FORCE ROW LEVEL SECURITY is effective.
 *
 * Skipped when DATABASE_URL is not set (CI without a database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import pino from 'pino';
import express from 'express';
import { createMetrics } from '../../core/metrics.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createRateLimiters } from '../../core/rate-limit.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';
import { createAdminRoutes } from './routes.js';
import { createApiApp } from '../../server.js';
import type { AppContext } from '../../core/context.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_SECRET = 'test-admin-e2e-secret';

describe.skipIf(!DATABASE_URL)('Token management e2e', () => {
  let pool: pg.Pool;
  let adminBaseUrl: string;
  let apiBaseUrl: string;
  let adminServer: http.Server;
  let apiServer: http.Server;
  let wasSuperuser = false;
  const tenantIds: string[] = [];

  async function createTestTenant(name: string): Promise<string> {
    const slug = `e2e-${name}-${Date.now()}`;
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO tenant.tenants (name, slug) VALUES ($1, $2) RETURNING id',
      [name, slug],
    );
    const id = rows[0]!.id;
    tenantIds.push(id);
    return id;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });

    // Ensure FORCE ROW LEVEL SECURITY is set on data tables and that
    // the current role is not a superuser (superusers always bypass RLS).
    const { rows: roleRows } = await pool.query<{ rolsuper: boolean }>(
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    wasSuperuser = roleRows[0]?.rolsuper ?? false;
    if (wasSuperuser) {
      await pool.query('ALTER ROLE CURRENT_USER NOSUPERUSER');
    }
    // Apply FORCE ROW LEVEL SECURITY (idempotent if already set by migration)
    await pool.query(`
      ALTER TABLE xapi.statements  FORCE ROW LEVEL SECURITY;
      ALTER TABLE xapi.documents   FORCE ROW LEVEL SECURITY;
      ALTER TABLE xapi.activities  FORCE ROW LEVEL SECURITY;
      ALTER TABLE xapi.agents      FORCE ROW LEVEL SECURITY;
      ALTER TABLE xapi.attachments FORCE ROW LEVEL SECURITY;
    `);

    const config = parseConfigFromEnv({
      NODE_ENV: 'test',
      DATABASE_URL: DATABASE_URL!,
      API_PORT: '0',
      ADMIN_PORT: '0',
      ADMIN_SECRET,
    });

    const ctx: AppContext = {
      config,
      logger: pino({ level: 'silent' }),
      pool,
      metrics: createMetrics(config),
      jwtVerifier: {
        verifyToken: () => Promise.reject(new Error('JWT not configured in e2e test')),
        seedFromDb: () => Promise.resolve(),
      } as AppContext['jwtVerifier'],
      assetStore: createLocalAssetStore(
        path.join(os.tmpdir(), 'xapi-lrs-e2e-tokens'),
      ),
      notifyListener: createMockNotifyListener(),
      rateLimiters: createRateLimiters(config),
      isShuttingDown: false,
    };

    // Admin server
    const adminApp = express();
    adminApp.disable('x-powered-by');
    adminApp.use(express.urlencoded({ extended: true }));
    adminApp.use(createAdminRoutes(ctx));
    adminServer = await new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer(adminApp);
      server.listen(0, '127.0.0.1', () => resolve(server));
      server.on('error', reject);
    });
    const adminAddr = adminServer.address() as { port: number };
    adminBaseUrl = `http://127.0.0.1:${adminAddr.port}`;

    // API server
    const apiApp = createApiApp(ctx);
    apiServer = await new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer(apiApp);
      server.listen(0, '127.0.0.1', () => resolve(server));
      server.on('error', reject);
    });
    const apiAddr = apiServer.address() as { port: number };
    apiBaseUrl = `http://127.0.0.1:${apiAddr.port}`;
  }, 15_000);

  afterAll(async () => {
    adminServer?.closeAllConnections();
    apiServer?.closeAllConnections();
    await new Promise<void>((r) => adminServer?.close(() => r()));
    await new Promise<void>((r) => apiServer?.close(() => r()));
    // Clean up test tenants (cascades to tokens + statements)
    for (const id of tenantIds) {
      await pool.query('DELETE FROM tenant.tenants WHERE id = $1', [id]);
    }
    await pool.end();

    // Restore superuser privilege if we revoked it.
    // Requires a separate superuser connection (e.g. postgres role).
    if (wasSuperuser) {
      const url = new URL(DATABASE_URL!);
      const restorePool = new pg.Pool({
        host: url.hostname,
        port: Number(url.port) || 5432,
        database: url.pathname.slice(1),
        user: 'postgres',
      });
      try {
        await restorePool.query(`ALTER ROLE ${url.username} SUPERUSER`);
      } catch {
        // Non-fatal: local dev DB is ephemeral (Docker tmpfs)
      } finally {
        await restorePool.end();
      }
    }
  }, 15_000);

  /** Helper: create a token via admin POST and return { tokenId, secret } */
  async function createToken(tenantId: string, userSub: string, scopes = 'all') {
    const res = await fetch(`${adminBaseUrl}/admin/tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ tenantId, userSub, scopes }).toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Token created.');
    const tokenId = html.match(/ID: ([a-f0-9-]+)/)![1]!;
    const secret = html.match(/Secret: ([A-Za-z0-9_-]+)/)![1]!;
    return { tokenId, secret };
  }

  /** Helper: make a Basic Auth header */
  function basicAuth(tokenId: string, secret: string): string {
    return `Basic ${Buffer.from(`${tokenId}:${secret}`).toString('base64')}`;
  }

  it('full lifecycle: create → auth → delete → auth fails', async () => {
    const tenantId = await createTestTenant('lifecycle-test');

    // 1. Create token
    const { tokenId, secret } = await createToken(tenantId, 'lifecycle-user');

    // 2. Use the token for an xAPI POST — should succeed
    const stmtRes = await fetch(`${apiBaseUrl}/xapi/statements`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(tokenId, secret),
        'X-Experience-API-Version': '1.0.3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        actor: { mbox: 'mailto:lifecycle@example.com' },
        verb: { id: 'http://example.com/lifecycle-verb' },
        object: { id: 'http://example.com/lifecycle-activity' },
      }]),
    });
    if (stmtRes.status !== 200) {
      const errBody = await stmtRes.text();
      expect.fail(`POST /xapi/statements returned ${stmtRes.status}: ${errBody}`);
    }
    const ids = await stmtRes.json();
    expect(ids).toHaveLength(1);

    // 3. Delete the token
    const deleteRes = await fetch(`${adminBaseUrl}/admin/tokens/${tokenId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(deleteRes.status).toBe(200);

    // 4. Same credentials should now fail with 401
    const failRes = await fetch(`${apiBaseUrl}/xapi/statements`, {
      headers: {
        Authorization: basicAuth(tokenId, secret),
        'X-Experience-API-Version': '1.0.3',
      },
    });
    if (failRes.status !== 401) {
      const body = await failRes.text();
      expect.soft(body).toBe('should have been 401');
    }
    expect(failRes.status).toBe(401);
  });

  it('rejects xAPI request with wrong secret (bcrypt mismatch)', async () => {
    const tenantId = await createTestTenant('wrong-secret-test');
    const { tokenId } = await createToken(tenantId, 'wrong-secret-user');

    const res = await fetch(`${apiBaseUrl}/xapi/statements`, {
      headers: {
        Authorization: basicAuth(tokenId, 'totally-wrong-secret'),
        'X-Experience-API-Version': '1.0.3',
      },
    });
    const resBody = await res.text();
    expect(res.status, `Wrong secret got ${res.status}: ${resBody}`).toBe(401);
  });

  it('tokens are isolated per tenant', async () => {
    const tenantA = await createTestTenant('tenant-a');
    const tenantB = await createTestTenant('tenant-b');

    // Create token under tenant A, post a statement
    const { tokenId: idA, secret: secretA } = await createToken(tenantA, 'user-a');
    const postRes = await fetch(`${apiBaseUrl}/xapi/statements`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(idA, secretA),
        'X-Experience-API-Version': '1.0.3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        actor: { mbox: 'mailto:a@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity-a' },
      }]),
    });
    expect(postRes.status).toBe(200);

    // Create token under tenant B, query statements — should see none from A
    const { tokenId: idB, secret: secretB } = await createToken(tenantB, 'user-b');
    const getRes = await fetch(`${apiBaseUrl}/xapi/statements`, {
      headers: {
        Authorization: basicAuth(idB, secretB),
        'X-Experience-API-Version': '1.0.3',
      },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.statements).toHaveLength(0);
  });
});
