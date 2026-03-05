import type http from 'node:http';
import type { AppContext } from './context.js';
import { destroyRateLimiters } from './rate-limit.js';

export async function gracefulShutdown(
  ctx: AppContext,
  apiServer: http.Server | null,
  adminServer: http.Server,
): Promise<void> {
  const { config, logger } = ctx;

  // 1. Readiness probe starts returning 503
  ctx.isShuttingDown = true;
  logger.info('Graceful shutdown initiated');

  const drainTimeout = Math.floor(config.SHUTDOWN_TIMEOUT_MS * 0.8);

  // 2. Close API server — stop accepting, drain, force-kill
  if (apiServer) {
    apiServer.close();
    apiServer.closeIdleConnections();
    const forceTimer = setTimeout(() => {
      logger.warn('Force-closing remaining API connections');
      apiServer.closeAllConnections();
    }, drainTimeout);

    await new Promise<void>((resolve) => apiServer.on('close', resolve));
    clearTimeout(forceTimer);
  }

  // 3. Close admin server (immediate, should be idle by now)
  adminServer.close();
  adminServer.closeIdleConnections();
  await new Promise<void>((resolve) => adminServer.on('close', resolve));

  // 4. Stop forward worker (before notify listener — worker needs both to flush)
  if (ctx.forwardWorker) {
    try {
      await ctx.forwardWorker.stop();
      logger.info('Forward worker stopped');
    } catch (err) {
      logger.error({ err }, 'Error stopping forward worker');
    }
  }

  // 5. Stop PG LISTEN/NOTIFY listener
  try {
    await ctx.notifyListener.stop();
    logger.info('PG notify listener stopped');
  } catch (err) {
    logger.error({ err }, 'Error stopping PG notify listener');
  }

  // 6. Stop rate limiter prune timers
  destroyRateLimiters(ctx.rateLimiters);

  // 7. Close DB connection pool
  try {
    await ctx.pool.end();
    logger.info('Database connection pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database connection pool');
  }

  logger.info('Graceful shutdown complete');
}
