import { parseConfigFromEnv } from './core/config.js';
import { createAppContext } from './core/context.js';
import { startServer } from './server.js';

async function main() {
  // Phase 1: Config (synchronous, fails fast)
  const config = parseConfigFromEnv();

  // Phase 2: Build context (async, retries)
  const ctx = await createAppContext(config);
  const { logger } = ctx;

  // Phase 3: Start servers
  const handle = await startServer(ctx);

  // Signal handling
  let isShuttingDown = false;
  const shutdownWithTimeout = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received');

    const hardTimer = setTimeout(() => {
      logger.fatal('Shutdown timed out, forcing exit');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    hardTimer.unref();

    try {
      await handle.shutdown();
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'));
  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdownWithTimeout('uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'Unhandled rejection');
    shutdownWithTimeout('unhandledRejection');
  });

  logger.info(
    { apiPort: config.API_PORT, adminPort: config.ADMIN_PORT, mode: config.RUN_MODE },
    'Server started successfully',
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
