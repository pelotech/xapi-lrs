import type http from 'node:http';
import type { AppContext } from './context.js';

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

  // 4. Close DB connection pool
  try {
    await ctx.pool.end();
    logger.info('Database connection pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database connection pool');
  }

  logger.info('Graceful shutdown complete');
}
