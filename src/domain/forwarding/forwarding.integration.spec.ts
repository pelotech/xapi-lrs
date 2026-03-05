import { describe, expect, it, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import express from 'express';
import { createMetrics } from '../../core/metrics.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createRateLimiters } from '../../core/rate-limit.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';
import { createAdminRoutes } from '../admin/routes.js';
import type { AppContext } from '../../core/context.js';

const ADMIN_SECRET = 'test-admin-secret-1234';

function createMockPool(queryFn?: (...args: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>) {
  const defaultQuery = () => Promise.resolve({ rows: [], rowCount: 0 });
  return {
    query: queryFn ?? defaultQuery,
    connect: () => Promise.resolve({ query: queryFn ?? defaultQuery, release: () => undefined }),
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
      verifyToken: () => Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' }),
      seedFromDb: () => Promise.resolve(),
    } as AppContext['jwtVerifier'],
    assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-test-assets')),
    notifyListener: createMockNotifyListener(),
    rateLimiters: createRateLimiters(config),
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
  return { ready, close, ctx };
}

describe('Admin Forwarding UI', () => {
  let closeFn: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeFn) {
      await closeFn();
      closeFn = undefined;
    }
  });

  it('GET /admin/forwarding returns 200 with HTML table', async () => {
    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets')) {
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

    const res = await fetch(`${baseUrl}/admin/forwarding`, {
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
      },
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Statement Forwarding');
    expect(html).toContain('forwarding-table');
  });

  it('POST /admin/forwarding creates a target', async () => {
    let upsertCalled = false;
    let upsertParams: unknown[] = [];

    const pool = createMockPool((sql: unknown, params?: unknown) => {
      const query = String(sql);
      if (query.includes('INSERT INTO tenant.forward_targets')) {
        upsertCalled = true;
        upsertParams = params as unknown[];
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('forward_targets') && query.includes('SELECT')) {
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

    const res = await fetch(`${baseUrl}/admin/forwarding`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        tenantId: '11111111-1111-1111-1111-111111111111',
        url: 'http://upstream/xapi/statements',
        authHeader: 'Basic abc',
        enabled: 'true',
      }).toString(),
    });

    expect(res.status).toBe(200);
    expect(upsertCalled).toBe(true);
    expect(upsertParams[0]).toBe('11111111-1111-1111-1111-111111111111');
    expect(upsertParams[1]).toBe('http://upstream/xapi/statements');
    expect(upsertParams[2]).toBe('Basic abc');
    expect(upsertParams[3]).toBe(true);
  });

  it('DELETE /admin/forwarding/:tenantId removes a target', async () => {
    let deleteCalled = false;
    let deleteTenantId: string | undefined;

    const pool = createMockPool((sql: unknown, params?: unknown) => {
      const query = String(sql);
      if (query.includes('DELETE FROM tenant.forward_targets')) {
        deleteCalled = true;
        deleteTenantId = (params as string[])[0];
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('forward_targets') && query.includes('SELECT')) {
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

    const tenantId = '22222222-2222-2222-2222-222222222222';
    const res = await fetch(`${baseUrl}/admin/forwarding/${tenantId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
      },
    });

    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(true);
    expect(deleteTenantId).toBe(tenantId);
  });

  it('POST /admin/forwarding returns 400 if missing fields', async () => {
    const pool = createMockPool();
    const { ready, close } = startAdminServer(pool);
    closeFn = close;
    const baseUrl = await ready;

    const res = await fetch(`${baseUrl}/admin/forwarding`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ tenantId: '' }).toString(),
    });

    expect(res.status).toBe(400);
  });
});
