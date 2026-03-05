import { describe, expect, it, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import express from 'express';
import { createMetrics } from '../../core/metrics.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';
import { createAdminRoutes } from './routes.js';
import type { AppContext } from '../../core/context.js';

const ADMIN_SECRET = 'test-admin-secret-1234';

function createMockPool(
  queryFn?: (...args: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>,
) {
  const defaultQuery = () => Promise.resolve({ rows: [], rowCount: 0 });
  return {
    query: queryFn ?? defaultQuery,
    connect: () =>
      Promise.resolve({ query: queryFn ?? defaultQuery, release: () => undefined }),
    end: () => Promise.resolve(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    on: () => undefined,
  } as unknown as import('pg').Pool;
}

function startAdminServer(pool: import('pg').Pool) {
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/test',
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
      verifyToken: () =>
        Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' }),
      seedFromDb: () => Promise.resolve(),
    } as AppContext['jwtVerifier'],
    assetStore: createLocalAssetStore(
      path.join(os.tmpdir(), 'xapi-lrs-test-assets'),
    ),
    notifyListener: createMockNotifyListener(),
    isShuttingDown: false,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: true }));
  app.use(createAdminRoutes(ctx));

  const server = http.createServer(app);

  const ready = new Promise<string>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(`http://127.0.0.1:${String(addr.port)}`);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
    server.on('error', reject);
  });

  const close = () => new Promise<void>((r) => server.close(() => r()));
  return { ready, close };
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_SECRET}`, ...extra };
}

describe('Admin Token Management', () => {
  let closeFn: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeFn) {
      await closeFn();
      closeFn = undefined;
    }
  });

  it('GET /admin/tokens returns 200 with HTML table', async () => {
    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('xapi.tokens')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('tenant.tenants')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/tokens`, {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Tokens');
    expect(html).toContain('Create Token');
  });

  it('POST /admin/tokens creates a token and returns the plaintext secret', async () => {
    let insertCalled = false;
    let insertParams: unknown[] = [];

    const pool = createMockPool((sql: unknown, params?: unknown) => {
      const query = String(sql);
      if (query.includes('crypt') && query.includes('gen_salt')) {
        return Promise.resolve({ rows: [{ hash: '$2a$10$fakebcrypthash' }] });
      }
      if (query.includes('INSERT INTO xapi.tokens')) {
        insertCalled = true;
        insertParams = params as unknown[];
        return Promise.resolve({
          rows: [{ id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' }],
        });
      }
      if (query.includes('xapi.tokens') && query.includes('SELECT')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('tenant.tenants')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/tokens`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userSub: 'alice@example.com',
        scopes: 'all',
      }).toString(),
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Token created.');
    expect(html).toContain('cccccccc-cccc-4ccc-cccc-cccccccccccc');
    // The plaintext secret should appear in the response
    expect(html).toContain('Secret:');

    expect(insertCalled).toBe(true);
    expect(insertParams[0]).toBe('11111111-1111-1111-1111-111111111111');
    expect(insertParams[1]).toBe('alice@example.com');
    expect(insertParams[2]).toBe('$2a$10$fakebcrypthash');
    expect(insertParams[3]).toEqual(['all']);
  });

  it('POST /admin/tokens returns 400 if missing fields', async () => {
    const pool = createMockPool();
    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/tokens`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ tenantId: '' }).toString(),
    });

    expect(res.status).toBe(400);
  });

  it('POST /admin/tokens returns 400 if no scopes provided', async () => {
    const pool = createMockPool();
    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/tokens`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userSub: 'alice@example.com',
      }).toString(),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('scope');
  });

  it('POST /admin/tokens returns 400 for invalid scopes', async () => {
    const pool = createMockPool();
    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/tokens`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userSub: 'alice@example.com',
        scopes: 'bogus_scope',
      }).toString(),
    });

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid scopes');
    expect(text).toContain('bogus_scope');
  });

  it('DELETE /admin/tokens/:id removes the token', async () => {
    let deleteCalled = false;
    let deleteId: string | undefined;

    const pool = createMockPool((sql: unknown, params?: unknown) => {
      const query = String(sql);
      if (query.includes('DELETE FROM xapi.tokens')) {
        deleteCalled = true;
        deleteId = (params as string[])[0];
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('xapi.tokens') && query.includes('SELECT')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('tenant.tenants')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const tokenId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
    const res = await fetch(`${baseUrl}/admin/tokens/${tokenId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);
    expect(deleteId).toBe(tokenId);
  });
});
