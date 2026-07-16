import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { describe, test, expect, beforeEach } from 'vitest';
import { tracingMiddleware } from '../../../src/middleware/tracing.ts';
import { makeTestTracer } from '../helpers/otel-test-tracer.ts';

describe('tracingMiddleware', () => {
  let exporter: InMemorySpanExporter;
  let app: Hono;

  beforeEach(() => {
    const t = makeTestTracer();
    exporter = t.exporter;
    app = new Hono();
    app.use('/xapi/*', tracingMiddleware(t.tracer));
    app.get('/xapi/statements/:id', (c) => c.text('ok'));
    app.get('/xapi/boom', () => {
      throw new Error('kaboom');
    });
  });

  test('emits one SERVER span named by method + matched route', async () => {
    await app.request('/xapi/statements/abc');
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe(SpanKind.SERVER);
    expect(spans[0].name).toBe('GET /xapi/statements/:id');
    expect(spans[0].attributes['http.route']).toBe('/xapi/statements/:id');
    expect(spans[0].attributes['http.response.status_code']).toBe(200);
  });

  test('records exception and ERROR status on a thrown handler', async () => {
    await app.request('/xapi/boom');
    const span = exporter.getFinishedSpans()[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });
});
