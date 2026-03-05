import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createMetrics } from '../../core/metrics.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createRateLimiters } from '../../core/rate-limit.js';
import { createApiApp } from '../../server.js';
import type { AppContext } from '../../core/context.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';

export const TOKEN_ID = '00000000-0000-4000-8000-000000000001';
export const TOKEN_SECRET = 'test-secret';

export function basicAuth(id: string = TOKEN_ID, secret: string = TOKEN_SECRET): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

export function xapiHeaders(auth: string): Record<string, string> {
  return { 'X-Experience-API-Version': '1.0.3', 'Authorization': auth };
}

export const VALID_STATEMENT = {
  actor: { mbox: 'mailto:test@example.com' },
  verb: { id: 'http://example.com/did' },
  object: { id: 'http://example.com/activity' },
};

export const MOCK_JWT_VERIFIER = {
  verifyToken: (token: string) => {
    if (token === 'valid-jwt-token') {
      return Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' });
    }
    return Promise.reject(new Error('Invalid JWT'));
  },
  seedFromDb: () => Promise.resolve(),
};

type QueryArg = string | { name?: string; text?: string; values?: unknown[] };

export function scopedMockPool(scopes: string[]) {
  const statements = new Map<string, { raw: Record<string, unknown> }>();

  const queryFn = (sqlOrConfig: QueryArg, maybeValues?: unknown[]) => {
    const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
    const text = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';
    const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : maybeValues;

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
      const id = values?.[0] as string;
      const rawJson = values?.[6] as string;
      statements.set(id, { raw: JSON.parse(rawJson) });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (name === 'xapi_stmt_get') {
      const id = values?.[0] as string;
      const row = statements.get(id);
      if (row) return Promise.resolve({ rows: [row], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (name === 'xapi_stmt_consistent_through') {
      return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
    }
    if (name === 'xapi_activity_upsert') {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (name === 'xapi_agent_upsert') {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (text.includes('SELECT raw, stored, id')) {
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
    statements,
  };
}

export function startScopedServer(scopes: string[]) {
  const { pool } = scopedMockPool(scopes);
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    API_PORT: '0',
    ADMIN_PORT: '0',
  });
  const ctx: AppContext = {
    config,
    logger: pino({ level: 'silent' }),
    pool,
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
