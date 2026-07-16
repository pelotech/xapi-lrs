import { describe, test, expect, afterEach } from 'vitest';
import { initTracing } from '../../src/tracing.ts';

describe('initTracing', () => {
  const OTLP_KEYS = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'];
  afterEach(() => OTLP_KEYS.forEach((k) => delete process.env[k]));

  test('disabled when no OTLP endpoint is configured', async () => {
    const h = initTracing({}); // empty env
    expect(h.enabled).toBe(false);
    expect(h.tracer.startSpan('x').isRecording()).toBe(false); // no-op tracer
    await expect(h.shutdown()).resolves.toBeUndefined();
  });

  test('enabled when an endpoint is set', async () => {
    const h = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });
    expect(h.enabled).toBe(true);
    await h.shutdown(); // flush + shut down the provider registered by this test
  });

  test('disabled when the endpoint is an empty string', async () => {
    const h = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(h.enabled).toBe(false);
    await expect(h.shutdown()).resolves.toBeUndefined();
  });

  test('a disabled handle stays non-recording even after a later enabled init', async () => {
    const disabled = initTracing({});
    const enabled = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' });
    expect(disabled.tracer.startSpan('x').isRecording()).toBe(false);
    await enabled.shutdown();
  });
});
