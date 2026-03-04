/**
 * Integration test fixture — starts the API Express app on a random port
 * with a mock AppContext (no real DB connection).
 *
 * Usage with vitest:
 *
 *   import { apiTest } from '../test/api-fixture.js';
 *
 *   apiTest('GET /xapi/about returns version list', async ({ baseUrl, fetch }) => {
 *     const res = await fetch('/xapi/about', {
 *       headers: { 'X-Experience-API-Version': '1.0.3' },
 *     });
 *     expect(res.status).toBe(200);
 *   });
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import pino from 'pino';
import { createMetrics } from '../core/metrics.js';
import { parseConfigFromEnv } from '../core/config.js';
import { createLocalAssetStore } from '../core/asset-store.js';
import { EventEmitter } from 'node:events';
import type { AppContext } from '../core/context.js';
import type { PgNotifyListener } from '../core/pg-notify.js';
import { createApiApp } from '../server.js';

/** Mock PgNotifyListener backed by a plain EventEmitter. */
export function createMockNotifyListener(): PgNotifyListener {
  const emitter = new EventEmitter();
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    listen: () => Promise.resolve(),
    on: (ch: string, cb: (payload: string) => void) => emitter.on(ch, cb),
    off: (ch: string, cb: (payload: string) => void) => { emitter.off(ch, cb); },
    // Expose emitter for tests that need to emit synthetic events
    emit: (ch: string, payload: string) => emitter.emit(ch, payload),
  } as unknown as PgNotifyListener;
}

/** Minimal mock pg.Pool — returns empty result sets for all queries. */
function createMockPool() {
  const queryFn = () => Promise.resolve({ rows: [], rowCount: 0 });
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

function createTestContext(): AppContext {
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    API_PORT: '0',
    ADMIN_PORT: '0',
  });

  const logger = pino({ level: 'silent' });
  const pool = createMockPool();
  const metrics = createMetrics(config);

  return {
    config,
    logger,
    pool,
    metrics,
    jwtVerifier: {
      verifyToken: () => Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' }),
      seedFromDb: () => Promise.resolve(),
    },
    assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-test-assets')),
    notifyListener: createMockNotifyListener(),
    isShuttingDown: false,
  };
}

interface ApiFixture {
  /** Base URL of the running server, e.g. "http://127.0.0.1:12345" */
  readonly baseUrl: string;

  /** Convenience wrapper around global fetch that prepends baseUrl. */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Vitest `test.extend` fixture that starts the API server before each test
 * and shuts it down after.
 */
export const apiTest = test.extend<ApiFixture>({
  // eslint-disable-next-line no-empty-pattern
  baseUrl: async ({}, use) => {
    const ctx = createTestContext();
    const app = createApiApp(ctx);
    const server = http.createServer(app);

    const url = await new Promise<string>((resolve, reject) => {
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

    await use(url);

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  },

  fetch: async ({ baseUrl }, use) => {
    const fetchWithBase = (path: string, init?: RequestInit) =>
      fetch(`${baseUrl}${path}`, init);

    await use(fetchWithBase);
  },
});
