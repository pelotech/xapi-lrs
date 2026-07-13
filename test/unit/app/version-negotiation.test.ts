/**
 * Unit tests for xAPI version negotiation and alternate-request-syntax gating.
 *
 * These drive the real `createApp` factory with a stub pool — no DB. `/about`
 * is unauthenticated, and the version-negotiation middleware runs BEFORE auth,
 * so version rejections/echoes never touch the pool. The alternate-syntax gate
 * (Task 3) likewise runs before auth. Every assertion here is about the
 * protocol layer (status + X-Experience-API-Version header), not persistence.
 */

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.ts';
import type { AppDeps } from '../../../src/app.ts';
import { JwksCache } from '../../../src/auth/jwt.ts';
import type { LrsConfig } from '../../../src/config.ts';
import type { DbPool } from '../../../src/db.ts';
import { createMetrics } from '../../../src/metrics.ts';
import type { Listener } from '../../../src/sse/pg-listener.ts';

// A pool that throws if ever queried — proves these paths are genuinely DB-free.
const stubPool = {
  connect: () => {
    throw new Error('unit test pool.connect() should never be called');
  },
  query: () => {
    throw new Error('unit test pool.query() should never be called');
  },
  end: async () => {},
} as unknown as DbPool;

const stubListener: Listener = {
  on: () => {},
  off: () => {},
  start: async () => {},
  stop: async () => {},
  isReady: () => false,
};

function buildApp() {
  const config: LrsConfig = {
    port: 0,
    adminPort: 0,
    pgHost: 'localhost',
    pgPort: 5432,
    pgDatabase: 'test',
    pgUser: 'test',
    pgPassword: 'test',
    pgPoolSize: 5,
    dbConnectRetries: 1,
    dbConnectRetryDelayMs: 100,
    jwtIssuer: 'test-issuer',
    jwtAudience: 'test-audience',
    oidcDiscoveryUrl: undefined,
    jwksUri: 'http://localhost/jwks',
    corsEnabled: false,
    corsOrigin: '*',
    maxRequestBodyBytes: 50 * 1024 * 1024,
    sseMaxConnectionsGlobal: 100,
    sseMaxConnectionsPerIp: 5,
    xapiVerifySignatures: false,
    trustedProxyHops: 0,
    xapiRateLimitWindow: 60,
    xapiRateLimitMax: 10000,
    stmtGetDefault: 50,
    stmtGetMax: 50,
    shutdownTimeoutMs: 5_000,
    pgStatementTimeoutMs: 30_000,
    pgIdleInTransactionTimeoutMs: 60_000,
    databaseDriver: 'pg',
    pgliteDataDir: undefined,
    autoMigrate: false,
    logLevel: 'silent',
    nodeEnv: 'test',
  } as LrsConfig;

  const deps: AppDeps = {
    config,
    pool: stubPool,
    jwksCache: new JwksCache(),
    jwtConfig: null,
    metrics: createMetrics(),
    // pino not needed — createApp uses its own child logger from deps.logger.
    logger: { child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }) } as never,
    pgListener: stubListener,
    sessionSecret: 'test-secret',
    startedAt: new Date(),
    shutdownSignal: new AbortController().signal,
  };

  return createApp(deps);
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe('xAPI version negotiation middleware', () => {
  describe('/xapi/about (header optional)', () => {
    it('no version header → 200, echoes latest supported 2.0.0', async () => {
      const res = await buildApp().fetch(req('/xapi/about'));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Experience-API-Version')).toBe('2.0.0');
    });

    it('1.0.3 header → 200, echoes 1.0.3', async () => {
      const res = await buildApp().fetch(req('/xapi/about', { headers: { 'X-Experience-API-Version': '1.0.3' } }));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Experience-API-Version')).toBe('1.0.3');
    });

    it('2.0.0 header → 200, echoes 2.0.0', async () => {
      const res = await buildApp().fetch(req('/xapi/about', { headers: { 'X-Experience-API-Version': '2.0.0' } }));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Experience-API-Version')).toBe('2.0.0');
    });

    it('2.0 header (no patch) → 200, echoes 2.0.0', async () => {
      const res = await buildApp().fetch(req('/xapi/about', { headers: { 'X-Experience-API-Version': '2.0' } }));
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Experience-API-Version')).toBe('2.0.0');
    });

    it('unsupported 3.0.0 header → 400, version header present and 1.0/2.0', async () => {
      const res = await buildApp().fetch(req('/xapi/about', { headers: { 'X-Experience-API-Version': '3.0.0' } }));
      expect(res.status).toBe(400);
      const echoed = res.headers.get('X-Experience-API-Version');
      expect(echoed).not.toBeNull();
      expect(echoed).toMatch(/^(1\.0|2\.0)/);
    });
  });

  describe('/xapi/statements (header required, negotiation before auth)', () => {
    it('2.0.0 header, no credential → not a version 400; echoes 2.0.0 (auth 401 downstream)', async () => {
      const res = await buildApp().fetch(req('/xapi/statements', { headers: { 'X-Experience-API-Version': '2.0.0' } }));
      // The version middleware accepted 2.0.0 and set the response header before
      // auth ran; the request then fails auth (not a version rejection).
      expect(res.headers.get('X-Experience-API-Version')).toBe('2.0.0');
      expect(res.status).not.toBe(400);
      expect(res.status).toBe(401);
    });

    it('no version header → 400', async () => {
      const res = await buildApp().fetch(req('/xapi/statements'));
      expect(res.status).toBe(400);
      expect(res.headers.get('X-Experience-API-Version')).not.toBeNull();
    });

    it('unsupported 0.9 header → 400', async () => {
      const res = await buildApp().fetch(req('/xapi/statements', { headers: { 'X-Experience-API-Version': '0.9' } }));
      expect(res.status).toBe(400);
      expect(res.headers.get('X-Experience-API-Version')).not.toBeNull();
    });
  });
});
