/**
 * SSE Producer — GET /xapi/stream
 * Bridges pg_notify → Server-Sent Events.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { AuthInfo } from '../auth/types.ts';
import type { DbPool } from '../db.ts';
import { canonicalAgentIfi } from '../helpers/agent.ts';
import { hasOnlyMineScope, agentIfiFromAuth } from '../helpers/auth-agent.ts';
import { resolveClientIp } from '../helpers/client-ip.ts';
import type { Logger } from '../logger.ts';
import type { LrsMetrics } from '../metrics.ts';
import type { Listener } from './pg-listener.ts';
import { XAPI_NOTIFY_CHANNEL, HEARTBEAT_INTERVAL_MS, buildStatementEvent } from './statement-event.ts';

export interface SseProducerDeps {
  pool: DbPool;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: Listener;
  maxConnectionsGlobal: number;
  maxConnectionsPerIp: number;
  trustedProxyHops: number;
  /** Fires on SIGTERM/SIGINT — heartbeat loops must exit so the process can shut down. */
  shutdownSignal: AbortSignal;
}

/** Resolves when the signal aborts. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export function createSseRoute(deps: SseProducerDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  const { pool, metrics, logger, pgListener } = deps;

  // Connection tracking
  let globalCount = 0;
  const perIpCount = new Map<string, number>();

  app.get('/stream', (c) => {
    const log = (c as unknown as { var: { logger?: Logger } }).var.logger ?? logger;
    const ip = resolveClientIp(c.req.header('x-forwarded-for'), deps.trustedProxyHops);
    const auth = (c as unknown as { var: { auth: AuthInfo } }).var.auth;
    const mineOnly = auth ? hasOnlyMineScope(auth.payload.scopes) : false;
    const authIfi = mineOnly ? agentIfiFromAuth(auth) : null;
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
    log.debug({ ip }, 'SSE client connected');

    return streamSSE(c, async (stream) => {
      const handler = (payload: string) => {
        void (async () => {
          try {
            const event = await buildStatementEvent(pool, metrics, payload);
            if (!event) {
              log.warn('Statement not found for SSE event');
              return;
            }

            // Filter events for statements/read/mine scope
            if (authIfi && event.statement) {
              const actor = (event.statement as Record<string, unknown>).actor as Record<string, unknown> | undefined;
              if (!actor) return;
              try {
                if (canonicalAgentIfi(actor) !== authIfi) return;
              } catch {
                return;
              }
            }

            await stream.writeSSE({
              id: event.seq,
              event: 'statement_stored',
              data: JSON.stringify(event),
            });
            metrics.sseEventsEmitted.add(1);
          } catch (err) {
            log.error(err, 'Failed to fetch statement for SSE');
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
        log.debug({ ip }, 'SSE client disconnected');
      });

      // Heartbeat loop — keeps connection alive. Exits on server shutdown
      // (deps.shutdownSignal aborts) so the process can finish draining.
      while (!deps.shutdownSignal.aborted) {
        await stream.write(':heartbeat\n\n');
        await Promise.race([stream.sleep(HEARTBEAT_INTERVAL_MS), waitForAbort(deps.shutdownSignal)]);
      }
    });
  });

  return app;
}
