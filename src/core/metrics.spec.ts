import { normalizeRoute, createMetrics } from './metrics.js';
import type { AppConfig } from './config.js';

describe('normalizeRoute', () => {
  it('replaces UUIDs with :id', () => {
    expect(normalizeRoute('/courses/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/courses/:id',
    );
  });

  it('replaces numeric path segments with :id', () => {
    expect(normalizeRoute('/users/123/posts/456')).toBe('/users/:id/posts/:id');
  });

  it('leaves non-matching paths unchanged', () => {
    expect(normalizeRoute('/v1/healthcheck')).toBe('/v1/healthcheck');
  });

  it('handles mixed UUIDs and numbers', () => {
    expect(
      normalizeRoute('/orgs/550e8400-e29b-41d4-a716-446655440000/users/42'),
    ).toBe('/orgs/:id/users/:id');
  });
});

describe('createMetrics', () => {
  const baseConfig = {
    ENABLE_METRICS: true,
  } as AppConfig;

  it('creates registry with expected metrics', () => {
    const metrics = createMetrics(baseConfig);
    expect(metrics.registry).toBeDefined();
    expect(metrics.httpRequestDuration).toBeDefined();
    expect(metrics.httpRequestsTotal).toBeDefined();
    expect(metrics.httpActiveConnections).toBeDefined();
  });

  it('skips default metrics when ENABLE_METRICS is false', async () => {
    const metrics = createMetrics({ ...baseConfig, ENABLE_METRICS: false });
    const output = await metrics.registry.metrics();
    // Should still have our custom metrics but not default Node.js metrics
    expect(output).not.toContain('nodejs_heap_size_total_bytes');
  });
});
