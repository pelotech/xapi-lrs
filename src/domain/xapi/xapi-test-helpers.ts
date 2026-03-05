import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createMetrics } from '../../core/metrics.js';
import { parseConfigFromEnv } from '../../core/config.js';
import { createLocalAssetStore } from '../../core/asset-store.js';
import { createRateLimiters } from '../../core/rate-limit.js';
import { createMockNotifyListener } from '../../test/api-fixture.js';
import { createApiApp } from '../../server.js';

export const XAPI_HEADERS = {
  'X-Experience-API-Version': '1.0.3',
  'Authorization': 'Bearer test-token',
};

export interface MockDocRow {
  content: Buffer;
  content_type: string;
  etag: string;
  updated_at: Date;
}

/**
 * Create a mock pool that returns a specific document row for named GET queries.
 * All other named queries return empty results.
 */
export function docMockPool(docsByQueryName: Record<string, MockDocRow>) {
  return wrapMockPool((sqlOrConfig) => {
    if (typeof sqlOrConfig === 'object' && sqlOrConfig.name) {
      const doc = docsByQueryName[sqlOrConfig.name];
      if (doc) return Promise.resolve({ rows: [doc], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

type QueryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }, maybeValues?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

/** Wrap a query function with the boilerplate needed to satisfy pg.Pool. */
export function wrapMockPool(queryFn: QueryFn): import('pg').Pool {
  return {
    query: queryFn,
    connect: () => Promise.resolve({ query: queryFn, release: () => undefined }),
    end: () => Promise.resolve(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    on: () => undefined,
  } as unknown as import('pg').Pool;
}

export function startTestServer(pool: import('pg').Pool) {
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    API_PORT: '0',
    ADMIN_PORT: '0',
  });
  const ctx = {
    config,
    logger: pino({ level: 'silent' }),
    pool,
    metrics: createMetrics(config),
    jwtVerifier: {
      verifyToken: () => Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' }),
      seedFromDb: () => Promise.resolve(),
    },
    assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-test-assets')),
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
