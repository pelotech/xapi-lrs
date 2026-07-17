import { SpanKind } from '@opentelemetry/api';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { describe, test, expect } from 'vitest';
import { tracingMiddleware } from '../../../src/middleware/tracing.ts';
import { createSseRoute, type SseProducerDeps } from '../../../src/sse/sse-producer.ts';
import { makeTestTracer } from '../helpers/otel-test-tracer.ts';

// Rejects if `p` hasn't settled within `ms` — used to prove the tracing middleware
// returns as soon as the SSE Response is handed back, rather than blocking until the
// (potentially hours-long) stream closes.
async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// Minimal stubs — opening `/xapi/stream` only touches connection accounting and the
// listener registration; the pool is used exclusively from the pg_notify callback,
// which never fires in these tests.
function makeDeps(shutdownSignal: AbortSignal): SseProducerDeps {
  const noop = () => {};
  return {
    pool: { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as SseProducerDeps['pool'],
    metrics: {
      sseClients: { add: noop },
      sseEventsEmitted: { add: noop },
    } as unknown as SseProducerDeps['metrics'],
    logger: {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      child() {
        return this;
      },
    } as unknown as SseProducerDeps['logger'],
    pgListener: { on: noop, off: noop } as unknown as SseProducerDeps['pgListener'],
    maxConnectionsGlobal: 100,
    maxConnectionsPerIp: 10,
    trustedProxyHops: 0,
    shutdownSignal,
  };
}

describe('createSseRoute (/xapi/stream)', () => {
  test('opens an SSE stream under the tracing middleware without blocking on it', async () => {
    const { tracer, exporter } = makeTestTracer();
    // An already-aborted signal makes the heartbeat loop exit on its first check, so the
    // stream closes immediately and leaves no lingering 30s timer for the test runner.
    const deps = makeDeps(AbortSignal.abort());

    const app = new Hono();
    app.use('/xapi/*', tracingMiddleware(tracer));
    app.route('/xapi', createSseRoute(deps));

    const res = await withTimeout(
      Promise.resolve(app.request('/xapi/stream')),
      2000,
      'request hung — the tracing middleware blocked on the long-lived SSE stream',
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // The request span ended at stream setup (not for the stream's lifetime): it is
    // already finished and exported by the time app.request() resolves.
    const span = exporter.getFinishedSpans().find((s) => s.kind === SpanKind.SERVER);
    expect(span).toBeDefined();
    expect(span!.attributes['http.route']).toBe('/xapi/stream');
  });

  test('rejects with 503 when the global connection cap is exhausted', async () => {
    const deps = { ...makeDeps(AbortSignal.abort()), maxConnectionsGlobal: 0 };
    const app = new Hono();
    app.route('/xapi', createSseRoute(deps));

    const res = await app.request('/xapi/stream');
    expect(res.status).toBe(503);
  });

  test('rejects with 429 when the per-IP connection cap is exhausted', async () => {
    const deps = { ...makeDeps(AbortSignal.abort()), maxConnectionsGlobal: 100, maxConnectionsPerIp: 0 };
    const app = new Hono();
    app.route('/xapi', createSseRoute(deps));

    const res = await app.request('/xapi/stream', { headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(res.status).toBe(429);
  });
});

describe('tracingMiddleware + streamSSE', () => {
  test('streams the response body through without swallowing or truncating it', async () => {
    const { tracer } = makeTestTracer();
    const app = new Hono();
    app.use('/xapi/*', tracingMiddleware(tracer));
    // Self-closing stream: writes one event then returns, so the readable completes and
    // res.text() resolves — proving the traced middleware doesn't intercept the body.
    app.get('/xapi/stream', (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'statement_stored', data: 'hello' });
      }),
    );

    const res = await app.request('/xapi/stream');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('event: statement_stored');
    expect(body).toContain('data: hello');
  });
});
