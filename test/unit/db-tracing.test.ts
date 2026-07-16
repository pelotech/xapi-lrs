import { context, trace, SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'; // re-exports the base test utilities
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { poolQuery, setDbTracer } from '../../src/db.ts';
import type { DbPool } from '../../src/db.ts';
import type { LrsMetrics } from '../../src/metrics.ts';

const metrics = { dbQueryDuration: { record() {} } } as unknown as LrsMetrics;
const pool = {
  async query() {
    return { rows: [], rowCount: 0 };
  },
} as unknown as DbPool;

function makeTestTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer('test'), exporter };
}

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
});
