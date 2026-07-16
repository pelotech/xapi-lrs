/**
 * Unit test for tracing middleware mounting in `createApp`.
 *
 * Drives the real `createApp` factory with a stub pool — no DB — and an
 * in-memory span exporter. `/xapi/about` is unauthenticated (see
 * version-negotiation.test.ts), so it's a safe route to exercise the full
 * middleware chain end to end without needing credentials.
 */

import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { describe, expect, test } from 'vitest';
import { createApp } from '../../../src/app.ts';
import type { AppDeps } from '../../../src/app.ts';
import { JwksCache } from '../../../src/auth/jwt.ts';
import type { LrsConfig } from '../../../src/config.ts';
import type { DbPool } from '../../../src/db.ts';
import { createMetrics } from '../../../src/metrics.ts';
import type { Listener } from '../../../src/sse/pg-listener.ts';

// Pool throws if queried: these paths must not touch the DB.
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

function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}

// Copied from `buildApp()` in test/unit/app/version-negotiation.test.ts (the
// canonical template) with `tracing` added.
function buildDeps(tracing: AppDeps['tracing']): AppDeps {
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

  return {
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
    tracing,
  };
}

describe('tracing mount', () => {
  test('mounts the middleware only when tracing.enabled', async () => {
    const { tracer, exporter } = makeTestTracer();

    const enabledApp = createApp(buildDeps({ enabled: true, tracer, shutdown: async () => {} }));
    await enabledApp.request('/xapi/about'); // /xapi/about is unauthenticated
    expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);

    exporter.reset();
    const disabledApp = createApp(
      buildDeps({ enabled: false, tracer: trace.getTracer('noop'), shutdown: async () => {} }),
    );
    await disabledApp.request('/xapi/about');
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
