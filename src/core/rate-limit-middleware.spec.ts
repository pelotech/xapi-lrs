import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { createMetrics } from './metrics.js';
import { parseConfigFromEnv } from './config.js';
import { createLocalAssetStore } from './asset-store.js';
import { createMockNotifyListener } from '../test/api-fixture.js';
import { createApiApp } from '../server.js';
import { SlidingWindowRateLimiter, type AppRateLimiters } from './rate-limit.js';
import type { AppContext } from './context.js';

/** Create a test context with a very low IP rate limit. */
function createLowLimitContext(overrides?: Partial<Record<keyof AppRateLimiters, SlidingWindowRateLimiter>>): AppContext {
  const config = parseConfigFromEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    API_PORT: '0',
    ADMIN_PORT: '0',
  });

  const rateLimiters: AppRateLimiters = {
    ip: overrides?.ip ?? new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 3 }),
    tenant: overrides?.tenant ?? new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 600 }),
    admin: overrides?.admin ?? new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 60 }),
    adminLogin: overrides?.adminLogin ?? new SlidingWindowRateLimiter({ windowMs: 900_000, maxRequests: 10 }),
  };

  return {
    config,
    logger: pino({ level: 'silent' }),
    pool: {
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
      connect: () => Promise.resolve({ query: () => Promise.resolve({ rows: [], rowCount: 0 }), release: () => undefined }),
      end: () => Promise.resolve(),
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      on: () => undefined,
    } as unknown as import('pg').Pool,
    metrics: createMetrics(config),
    jwtVerifier: {
      verifyToken: () => Promise.resolve({ iss: 'test-iss', aud: 'test-aud', sub: 'stub-user' }),
      seedFromDb: () => Promise.resolve(),
    },
    assetStore: createLocalAssetStore(path.join(os.tmpdir(), 'xapi-lrs-test-rl')),
    notifyListener: createMockNotifyListener(),
    rateLimiters,
    isShuttingDown: false,
  };
}

interface RateLimitFixture {
  baseUrl: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  cleanup: () => Promise<void>;
}

async function startServer(ctx: AppContext): Promise<RateLimitFixture> {
  const app = createApiApp(ctx);
  const server = http.createServer(app);

  const baseUrl = await new Promise<string>((resolve, reject) => {
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

  return {
    baseUrl,
    fetch: (p: string, init?: RequestInit) => fetch(`${baseUrl}${p}`, init),
    cleanup: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('Layer 1 — IP rate limit middleware', () => {
  let fixture: RateLimitFixture | null = null;

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
      fixture = null;
    }
  });

  it('allows requests under the limit', async () => {
    const ctx = createLowLimitContext();
    fixture = await startServer(ctx);

    for (let i = 0; i < 3; i++) {
      const res = await fixture.fetch('/xapi/about', {
        headers: { 'X-Experience-API-Version': '1.0.3' },
      });
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    const ctx = createLowLimitContext({
      ip: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 2 }),
    });
    fixture = await startServer(ctx);

    const headers = { 'X-Experience-API-Version': '1.0.3' };

    // First two should succeed
    expect((await fixture.fetch('/xapi/about', { headers })).status).toBe(200);
    expect((await fixture.fetch('/xapi/about', { headers })).status).toBe(200);

    // Third should be rate limited
    const res = await fixture.fetch('/xapi/about', { headers });
    expect(res.status).toBe(429);

    const body = await res.json() as { error: { status: number; code: string; message: string } };
    expect(body.error.status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toContain('Try again in');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('429 response includes X-Request-Id', async () => {
    const ctx = createLowLimitContext({
      ip: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }),
    });
    fixture = await startServer(ctx);

    const headers = { 'X-Experience-API-Version': '1.0.3' };
    await fixture.fetch('/xapi/about', { headers }); // exhaust limit

    const res = await fixture.fetch('/xapi/about', { headers });
    expect(res.status).toBe(429);

    const body = await res.json() as { error: { requestId?: string } };
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('checkTenantRateLimit', () => {
  it('throws error with RATE_LIMITED code when limit exceeded', async () => {
    const { checkTenantRateLimit } = await import('./rate-limit-middleware.js');
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    // First should pass
    expect(() => checkTenantRateLimit(limiter, 'tenant-1')).not.toThrow();

    // Second should throw
    expect(() => checkTenantRateLimit(limiter, 'tenant-1')).toThrow(
      /Too many requests/,
    );

    try {
      checkTenantRateLimit(limiter, 'tenant-1');
    } catch (err) {
      expect((err as Record<string, unknown>).status).toBe(429);
      expect((err as Record<string, unknown>).code).toBe('RATE_LIMITED');
      expect((err as Record<string, unknown>).retryAfterSec).toBeGreaterThan(0);
    }

    limiter.destroy();
  });

  it('allows different tenants independently', async () => {
    const { checkTenantRateLimit } = await import('./rate-limit-middleware.js');
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    expect(() => checkTenantRateLimit(limiter, 'tenant-a')).not.toThrow();
    expect(() => checkTenantRateLimit(limiter, 'tenant-b')).not.toThrow();

    // Both should now be rate limited
    expect(() => checkTenantRateLimit(limiter, 'tenant-a')).toThrow();
    expect(() => checkTenantRateLimit(limiter, 'tenant-b')).toThrow();

    limiter.destroy();
  });
});
