/**
 * SSE Producer — GET /xapi/stream
 * Bridges pg_notify → Server-Sent Events.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { Pool } from 'pg';
import type { LrsMetrics } from '../metrics.ts';
import type { Logger } from '../logger.ts';
import type { PgListener } from './pg-listener.ts';
import { XAPI_NOTIFY_CHANNEL, HEARTBEAT_INTERVAL_MS, buildStatementEvent } from './statement-event.ts';

export interface SseProducerDeps {
  pool: Pool;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: PgListener;
  maxConnectionsGlobal: number;
  maxConnectionsPerIp: number;
}

export function createSseRoute(deps: SseProducerDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  const { pool, metrics, logger, pgListener } = deps;

  // Connection tracking
  let globalCount = 0;
  const perIpCount = new Map<string, number>();

  app.get('/stream', (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipCount = perIpCount.get(ip) ?? 0;

    if (globalCount >= deps.maxConnectionsGlobal) {
      return c.json({ error: 'Too many SSE connections' }, 503);
    }
    if (ipCount >= deps.maxConnectionsPerIp) {
      return c.json({ error: 'Too many SSE connections from this IP' }, 429);
    }

    globalCount++;
    perIpCount.set(ip, ipCount + 1);
    metrics.sseClients.add(1);
    logger.debug({ ip }, 'SSE client connected');

    return streamSSE(c, async (stream) => {
      const handler = (payload: string) => {
        void (async () => {
          try {
            const event = await buildStatementEvent(pool, metrics, payload);
            if (!event) {
              logger.warn('Statement not found for SSE event');
              return;
            }

            await stream.writeSSE({
              id: event.seq,
              event: 'statement_stored',
              data: JSON.stringify(event),
            });
            metrics.sseEventsEmitted.add(1);
          } catch (err) {
            logger.error(err, 'Failed to fetch statement for SSE');
          }
        })();
      };

      pgListener.on(XAPI_NOTIFY_CHANNEL, handler);

      stream.onAbort(() => {
        pgListener.off(XAPI_NOTIFY_CHANNEL, handler);
        globalCount--;
        const remaining = (perIpCount.get(ip) ?? 1) - 1;
        if (remaining <= 0) perIpCount.delete(ip);
        else perIpCount.set(ip, remaining);
        metrics.sseClients.add(-1);
        logger.debug({ ip }, 'SSE client disconnected');
      });

      // Heartbeat loop — keeps connection alive
      while (true) {
        await stream.write(':heartbeat\n\n');
        await stream.sleep(HEARTBEAT_INTERVAL_MS);
      }
    });
  });

  return app;
}
