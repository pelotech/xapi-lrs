import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createMetrics } from '../../core/metrics.js';
import { createRateLimiters } from '../../core/rate-limit.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createApiApp } from '../../server.js';
import type { AppContext } from '../../core/context.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';
import {
  TOKEN_ID, basicAuth, xapiHeaders, VALID_STATEMENT,
  MOCK_JWT_VERIFIER, startScopedServer,
} from './xapi-scopes-test-helpers.js';

describe('scope: all/read', () => {
  const SCOPES = ['all/read'];

  it('allows GET /xapi/statements', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows GET /xapi/activities/state', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows GET /xapi/activities/profile', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('rejects POST /xapi/statements with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects PUT /xapi/activities/state with 403', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
          body: '{"key":"val"}',
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('JWT auth always gets scope=all', () => {
  it('allows GET /xapi/statements with Bearer token', async () => {
    const { ready, close } = startScopedServer(['should-not-matter']);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders('Bearer valid-jwt-token'),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows POST /xapi/statements with Bearer token', async () => {
    const { ready, close } = startScopedServer(['should-not-matter']);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders('Bearer valid-jwt-token'), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows PUT /xapi/activities/state with Bearer token', async () => {
    const { ready, close } = startScopedServer(['should-not-matter']);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders('Bearer valid-jwt-token'), 'Content-Type': 'application/json' },
          body: '{"key":"value"}',
        },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });
});

describe('combined scopes: statements/write + state', () => {
  const SCOPES = ['statements/write', 'state'];

  it('allows POST /xapi/statements', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_STATEMENT),
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('allows PUT /xapi/activities/state', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
          body: '{"key":"value"}',
        },
      );
      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/statements with 403 (no read scope)', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('rejects GET /xapi/agents with 403 (no profile scope)', async () => {
    const { ready, close } = startScopedServer(SCOPES);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(`${baseUrl}/xapi/agents?agent=${agent}`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(403);
    } finally {
      await close();
    }
  });
});

describe('define scope gates activity definition merging', () => {
  function activityTrackingPool(scopes: string[]) {
    let activityUpsertCalled = false;

    const queryFn = (
      sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] },
    ) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const text = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';

      if (text.includes('xapi.tokens') && text.includes('scopes')) {
        return Promise.resolve({ rows: [{ scopes }], rowCount: 1 });
      }
      if (text.includes('as_user_xapi_basic_auth') || text.includes('as_user_oidc')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (name === 'xapi_stmt_insert') {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (name === 'xapi_activity_upsert') {
        activityUpsertCalled = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (name === 'xapi_agent_upsert') {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return {
      pool: {
        query: queryFn,
        connect: () => Promise.resolve({ query: queryFn, release: () => undefined }),
        end: () => Promise.resolve(),
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        on: () => undefined,
      } as unknown as import('pg').Pool,
      wasActivityUpserted: () => activityUpsertCalled,
    };
  }

  function startTrackingServer(scopes: string[]) {
    const tracking = activityTrackingPool(scopes);
    const config = parseConfigFromEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      API_PORT: '0',
      ADMIN_PORT: '0',
    });
    const ctx: AppContext = {
      config,
      logger: pino({ level: 'silent' }),
      pool: tracking.pool,
      metrics: createMetrics(config),
      jwtVerifier: MOCK_JWT_VERIFIER,
      assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-scope-tests')),
      notifyListener: createMockNotifyListener(),
      rateLimiters: createRateLimiters(config),
      isShuttingDown: false,
    };
    const app = createApiApp(ctx);
    const server = http.createServer(app);

    const ready = new Promise<string>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(`http://127.0.0.1:${String(addr.port)}`);
        else reject(new Error('Failed to get server address'));
      });
      server.on('error', reject);
    });

    const close = () => new Promise<void>((r) => server.close(() => r()));
    return { ready, close, wasActivityUpserted: tracking.wasActivityUpserted };
  }

  it('merges activity definitions when credential has define scope', async () => {
    const { ready, close, wasActivityUpserted } = startTrackingServer(['statements/write', 'define']);
    const baseUrl = await ready;
    try {
      const stmtId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const res = await fetch(`${baseUrl}/xapi/statements?statementId=${stmtId}`, {
        method: 'PUT',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...VALID_STATEMENT,
          id: stmtId,
          object: { id: 'http://example.com/act', definition: { name: { en: 'Test' } } },
        }),
      });
      expect(res.status).toBe(204);
      expect(wasActivityUpserted()).toBe(true);
    } finally {
      await close();
    }
  });

  it('skips activity definition merging when credential lacks define scope', async () => {
    const { ready, close, wasActivityUpserted } = startTrackingServer(['statements/write']);
    const baseUrl = await ready;
    try {
      const stmtId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const res = await fetch(`${baseUrl}/xapi/statements?statementId=${stmtId}`, {
        method: 'PUT',
        headers: { ...xapiHeaders(basicAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...VALID_STATEMENT,
          id: stmtId,
          object: { id: 'http://example.com/act', definition: { name: { en: 'Test' } } },
        }),
      });
      expect(res.status).toBe(204);
      expect(wasActivityUpserted()).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('scope: statements/read/mine', () => {
  function readMineMockPool() {
    const STORED_RAW = {
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'http://example.com/did' },
      object: { id: 'http://example.com/activity' },
      authority: {
        objectType: 'Agent',
        account: { homePage: 'http://127.0.0.1', name: TOKEN_ID },
      },
    };

    const FOREIGN_RAW = {
      ...STORED_RAW,
      id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      authority: {
        objectType: 'Agent',
        account: { homePage: 'http://other-host.com', name: 'other-token-id' },
      },
    };

    const capturedSql: string[] = [];

    const queryFn = (
      sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] },
    ) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const text = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';

      if (text.includes('xapi.tokens') && text.includes('scopes')) {
        return Promise.resolve({ rows: [{ scopes: ['statements/read/mine'] }], rowCount: 1 });
      }
      if (text.includes('as_user_xapi_basic_auth') || text.includes('as_user_oidc')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
      }
      if (name === 'xapi_stmt_get') {
        const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : undefined;
        const id = values?.[0] as string;
        if (id === STORED_RAW.id) return Promise.resolve({ rows: [{ raw: STORED_RAW }], rowCount: 1 });
        if (id === FOREIGN_RAW.id) return Promise.resolve({ rows: [{ raw: FOREIGN_RAW }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('SELECT raw, stored, id')) {
        capturedSql.push(text);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return {
      pool: {
        query: queryFn,
        connect: () => Promise.resolve({ query: queryFn, release: () => undefined }),
        end: () => Promise.resolve(),
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        on: () => undefined,
      } as unknown as import('pg').Pool,
      capturedSql,
      STORED_RAW,
      FOREIGN_RAW,
    };
  }

  function startReadMineServer(mock: ReturnType<typeof readMineMockPool>) {
    const config = parseConfigFromEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/test',
      API_PORT: '0',
      ADMIN_PORT: '0',
    });
    const ctx: AppContext = {
      config,
      logger: pino({ level: 'silent' }),
      pool: mock.pool,
      metrics: createMetrics(config),
      jwtVerifier: { ...MOCK_JWT_VERIFIER },
      assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-scope-tests')),
      notifyListener: createMockNotifyListener(),
      rateLimiters: createRateLimiters(config),
      isShuttingDown: false,
    };
    const app = createApiApp(ctx);
    const server = http.createServer(app);

    const ready = new Promise<string>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(`http://127.0.0.1:${String(addr.port)}`);
        else reject(new Error('Failed to get server address'));
      });
      server.on('error', reject);
    });

    const close = () => new Promise<void>((r) => server.close(() => r()));
    return { ready, close };
  }

  it('multi-statement GET includes authority filter in SQL', async () => {
    const mock = readMineMockPool();
    const { ready, close } = startReadMineServer(mock);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: xapiHeaders(basicAuth()),
      });
      expect(res.status).toBe(200);
      expect(mock.capturedSql).toHaveLength(1);
      expect(mock.capturedSql[0]).toContain('authority');
      expect(mock.capturedSql[0]).toContain('@>');
    } finally {
      await close();
    }
  });

  it('single-statement GET rejects statements from other credentials', async () => {
    const mock = readMineMockPool();
    const { ready, close } = startReadMineServer(mock);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/statements?statementId=${mock.FOREIGN_RAW.id}`,
        { headers: xapiHeaders(basicAuth()) },
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('scope');
    } finally {
      await close();
    }
  });
});

describe('/xapi/about bypasses scope enforcement', () => {
  it('returns 200 even with empty scopes (no auth required)', async () => {
    const { ready, close } = startScopedServer([]);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/about`, {
        headers: { 'X-Experience-API-Version': '1.0.3' },
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
