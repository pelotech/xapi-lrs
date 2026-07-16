import { context, trace, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { poolQuery, setDbTracer, withClient } from '../../src/db.ts';
import type { DbPool, DbClient } from '../../src/db.ts';
import type { LrsMetrics } from '../../src/metrics.ts';
import { makeTestTracer } from './helpers/otel-test-tracer.ts';

const metrics = { dbQueryDuration: { record() {} } } as unknown as LrsMetrics;
const pool = {
  async query() {
    return { rows: [], rowCount: 0 };
  },
} as unknown as DbPool;

describe('db query spans', () => {
  let exporter: InMemorySpanExporter;
  let tracer: ReturnType<typeof makeTestTracer>['tracer'];
  // context.with only propagates across awaits with a context manager installed;
  // in production initTracing's provider.register() installs one. Enable it here.
  const cm = new AsyncLocalStorageContextManager();
  beforeAll(() => context.setGlobalContextManager(cm.enable()));
  afterAll(() => {
    cm.disable();
    context.disable();
  });
  beforeEach(() => {
    const t = makeTestTracer();
    exporter = t.exporter;
    tracer = t.tracer;
    setDbTracer(tracer);
  });
  afterEach(() => setDbTracer(trace.getTracer('xapi-lrs'))); // reset to no-op

  test('emits a CLIENT span nested under an active parent span', async () => {
    const parent = tracer.startSpan('parent');
    await context.with(trace.setSpan(context.active(), parent), () =>
      poolQuery(pool, metrics, { name: 'select_thing', text: 'SELECT 1' }),
    );
    parent.end();
    const dbSpan = exporter.getFinishedSpans().find((s) => s.name === 'db.query select_thing');
    expect(dbSpan).toBeDefined();
    expect(dbSpan!.kind).toBe(SpanKind.CLIENT);
    expect(dbSpan!.attributes['db.system']).toBe('postgresql');
    expect(dbSpan!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  test('emits NO span when there is no active recording span (admin/data-plane gate)', async () => {
    await poolQuery(pool, metrics, { name: 'select_thing', text: 'SELECT 1' });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test('instrumentQuery seam: a withClient transaction emits nested begin/query/commit spans', async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {},
    };
    const txPool = { connect: async () => client } as unknown as DbPool;

    const parent = tracer.startSpan('parent');
    await context.with(trace.setSpan(context.active(), parent), () =>
      withClient(txPool, metrics, async (c) => {
        await c.query({ name: 'select_x', text: 'SELECT 1' });
      }),
    );
    parent.end();

    const spans = exporter.getFinishedSpans();
    const names = spans.map((s) => s.name);
    // BEGIN and COMMIT flow through the same patched client.query, each a span.
    expect(names).toContain('db.query begin');
    expect(names).toContain('db.query select_x');
    expect(names).toContain('db.query commit');

    const querySpan = spans.find((s) => s.name === 'db.query select_x');
    expect(querySpan!.kind).toBe(SpanKind.CLIENT);
    expect(querySpan!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  test('instrumentQuery seam: callback-form query passes through (pg-pool reuses patched clients)', async () => {
    // node-pg clients support BOTH promise and callback forms. instrumentQuery
    // permanently patches client.query, and a released client keeps the patch, so
    // pool.query() later invokes it callback-style. The patch must not wrap that.
    const rawClient = {
      query: (_config: unknown, _values?: unknown, cb?: (e: unknown, r: unknown) => void) => {
        if (typeof cb === 'function') {
          cb(null, { rows: [], rowCount: 0 });
          return undefined;
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release: () => {},
    };
    const txPool = { connect: async () => rawClient } as unknown as DbPool;

    let patched: DbClient | undefined;
    await withClient(txPool, metrics, async (c) => {
      patched = c;
    });

    // Simulate pg-pool invoking the still-patched, released client callback-style.
    const callbackQuery = patched!.query as unknown as (...args: unknown[]) => unknown;
    const result = await new Promise<unknown>((resolve, reject) => {
      const ret = callbackQuery({ name: 'q', text: 'SELECT 1' }, undefined, (err: unknown, res: unknown) =>
        err ? reject(err) : resolve(res),
      );
      expect(ret).toBeUndefined(); // callback form must return undefined, not a broken promise
    });
    expect(result).toEqual({ rows: [], rowCount: 0 });
  });

  test('instrumentQuery seam: no spans without an active recording span (gate)', async () => {
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {},
    };
    const txPool = { connect: async () => client } as unknown as DbPool;
    await withClient(txPool, metrics, async (c) => {
      await c.query({ name: 'select_x', text: 'SELECT 1' });
    });
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
