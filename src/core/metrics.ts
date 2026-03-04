import client from 'prom-client';
import type pg from 'pg';
import type { AppConfig } from './config.js';

export interface AppMetrics {
  registry: client.Registry;
  httpRequestDuration: client.Histogram;
  httpRequestsTotal: client.Counter;
  httpActiveConnections: client.Gauge;
}

export function createMetrics(config: AppConfig): AppMetrics {
  const registry = new client.Registry();

  if (config.ENABLE_METRICS) {
    client.collectDefaultMetrics({ register: registry });
  }

  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });

  const httpActiveConnections = new client.Gauge({
    name: 'http_active_connections',
    help: 'Number of active HTTP connections',
    registers: [registry],
  });

  return { registry, httpRequestDuration, httpRequestsTotal, httpActiveConnections };
}

export function registerPoolMetrics(pool: pg.Pool, registry: client.Registry): void {
  const dbPoolSize = new client.Gauge({
    name: 'db_pool_size',
    help: 'Database connection pool size',
    labelNames: ['state'] as const,
    registers: [registry],
  });

  const update = () => {
    dbPoolSize.set({ state: 'total' }, pool.totalCount);
    dbPoolSize.set({ state: 'idle' }, pool.idleCount);
    dbPoolSize.set({ state: 'waiting' }, pool.waitingCount);
  };

  pool.on('connect', update);
  pool.on('release', update);
}

export function normalizeRoute(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/\d+/g, '/:id');
}
