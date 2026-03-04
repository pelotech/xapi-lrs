import http from 'node:http';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { ValidateError } from '@tsoa/runtime';
import { RegisterRoutes } from './build/routes.js';
import type { AppContext } from './core/context.js';
import { HttpError } from './core/errors.js';
import { normalizeRoute } from './core/metrics.js';
import { gracefulShutdown } from './core/shutdown.js';
import { xapiAlternateSyntaxMiddleware } from './domain/xapi/xapi-alternate-syntax.middleware.js';
import { xapiQueryParamsMiddleware } from './domain/xapi/xapi-query-params.middleware.js';
import { createAdminRoutes } from './domain/admin/routes.js';

export interface ServerHandle {
  shutdown(): Promise<void>;
  apiServer: http.Server | null;
  adminServer: http.Server;
}

export async function startServer(ctx: AppContext): Promise<ServerHandle> {
  const { config, logger } = ctx;
  const mode = config.RUN_MODE;

  // Admin server always starts
  const adminApp = createAdminApp(ctx);
  const adminServer = await listen(adminApp, config.ADMIN_PORT, 'Admin', logger);

  // API server starts in 'combined' and 'api' modes
  let apiServer: http.Server | null = null;
  if (mode === 'combined' || mode === 'api') {
    const apiApp = createApiApp(ctx);
    apiServer = await listen(apiApp, config.API_PORT, 'API', logger);
  }

  // TODO: start background worker in 'combined' and 'worker' modes

  return {
    apiServer,
    adminServer,
    shutdown: () => gracefulShutdown(ctx, apiServer, adminServer),
  };
}

/** Skip raw body parsing for urlencoded bodies (alternate request syntax). */
function rawExceptUrlencoded(req: http.IncomingMessage) {
  return req.headers['content-type'] !== 'application/x-www-form-urlencoded';
}

export function createApiApp(ctx: AppContext): express.Express {
  const { config, logger, metrics } = ctx;
  const app = express();

  // 1. Disable x-powered-by, trust proxy, disable auto-etag (xAPI manages ETags explicitly)
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', true);

  // 2. Store AppContext in app.locals
  app.locals['ctx'] = ctx;

  // 3. pino-http (attaches req.log and req.id)
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) =>
        (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
    }),
  );

  // 4. X-Request-Id echo header
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', String(req.id));
    next();
  });

  // 5. Body parsers
  // xAPI document resources accept arbitrary content types — parse as raw Buffer.
  // Exclude urlencoded so that alternate request syntax (POST ?method=…) is parsed
  // by express.urlencoded() instead.
  app.use('/xapi/activities/state', express.raw({ type: rawExceptUrlencoded, limit: '20mb' }));
  app.use('/xapi/activities/profile', express.raw({ type: rawExceptUrlencoded, limit: '20mb' }));
  app.use('/xapi/agents/profile', express.raw({ type: rawExceptUrlencoded, limit: '20mb' }));
  // Capture multipart/mixed bodies as raw Buffer for xAPI attachment handling
  app.use('/xapi/statements', express.raw({ type: 'multipart/mixed', limit: '50mb' }));
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.text());

  // 6. xAPI alternate request syntax (POST ?method=PUT → rewrite to PUT)
  // Must run after urlencoded body parser so form fields are available.
  app.use('/xapi', xapiAlternateSyntaxMiddleware);

  // 7. CORS
  app.use(cors({ origin: config.CORS_ALLOWED_ORIGINS }));

  // 8. OPTIONS preflight with per-resource Allow header (xAPI §6.8)
  const XAPI_ALLOWED_METHODS: Record<string, string> = {
    '/xapi/statements': 'GET, PUT, POST, HEAD, OPTIONS',
    '/xapi/activities/state': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    '/xapi/activities/profile': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    '/xapi/agents/profile': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    '/xapi/activities': 'GET, HEAD, OPTIONS',
    '/xapi/agents': 'GET, HEAD, OPTIONS',
    '/xapi/about': 'GET, HEAD, OPTIONS',
  };
  app.options('{*path}', (req: Request, res: Response) => {
    const allow = XAPI_ALLOWED_METHODS[req.path] ?? 'GET, HEAD, OPTIONS';
    res.setHeader('Allow', allow);
    res.sendStatus(204);
  });

  // 9. Metrics middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    metrics.httpActiveConnections.inc();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      metrics.httpActiveConnections.dec();
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const route = normalizeRoute(req.route?.path ?? req.path);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };
      metrics.httpRequestDuration.observe(labels, durationSec);
      metrics.httpRequestsTotal.inc(labels);
    });
    next();
  });

  // 10. Asset-serving middleware (static files from AssetStore)
  ctx.assetStore.mount?.(app);

  // 11. Reject unknown xAPI query parameters (before TSOA routes)
  app.use('/xapi', xapiQueryParamsMiddleware);

  // 12. TSOA-generated routes
  RegisterRoutes(app);

  // 13. Terminal 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: { status: 404, code: 'NOT_FOUND', message: 'Not Found' },
    });
  });

  // 14. Central error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.id ?? 'unknown';

    // xAPI §2.1.3: Consistent-Through MUST appear on ALL Statements Resource responses,
    // including error responses. Set it before sending any error from the statements endpoint.
    const isStatementsResource = req.path === '/statements' || req.path.endsWith('/statements');
    if (isStatementsResource && !res.headersSent) {
      res.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
    }

    if (err instanceof ValidateError) {
      res.status(400).json({
        error: {
          status: 400,
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          details: err.fields,
          requestId,
        },
      });
      return;
    }

    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: {
          status: err.status,
          code: err.code,
          message: err.message,
          requestId,
        },
      });
      return;
    }

    // Auth errors from TSOA (status set on error object)
    if (
      err instanceof Error &&
      'status' in err &&
      typeof (err as Record<string, unknown>).status === 'number'
    ) {
      const status = (err as Record<string, unknown>).status as number;
      res.status(status).json({
        error: { status, code: 'AUTH_ERROR', message: err.message, requestId },
      });
      return;
    }

    // PostgreSQL errors that map to HTTP 4xx
    if (err instanceof Error && 'code' in err) {
      const pgCode = (err as Record<string, unknown>).code;
      // invalid_authorization_specification → bad xAPI token
      if (pgCode === '28000' || pgCode === 'invalid_authorization_specification') {
        res.status(401).json({
          error: { status: 401, code: 'UNAUTHORIZED', message: 'Invalid credentials', requestId },
        });
        return;
      }
      // invalid datetime format (e.g. bad "since" parameter)
      if (pgCode === '22007') {
        res.status(400).json({
          error: { status: 400, code: 'BAD_REQUEST', message: 'Invalid timestamp value', requestId },
        });
        return;
      }
    }

    // JSON parse errors from document merge (e.g. trailing bytes in Buffer)
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      res.status(400).json({
        error: { status: 400, code: 'BAD_REQUEST', message: err.message, requestId },
      });
      return;
    }

    // Generic 500
    req.log?.error({ err, requestId }, 'Unhandled error');
    res.status(500).json({
      error: {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal Server Error',
        requestId,
      },
    });
  });

  return app;
}

function createAdminApp(ctx: AppContext): express.Express {
  const { config, metrics, pool } = ctx;
  const app = express();
  app.disable('x-powered-by');

  // Liveness — always 200
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness — 503 if shutting down or DB unreachable
  app.get('/ready', async (_req: Request, res: Response) => {
    if (ctx.isShuttingDown) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unreachable' });
    }
  });

  // Metrics — Prometheus text format
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });

  // Admin UI (only when ADMIN_SECRET is configured)
  if (config.ADMIN_SECRET) {
    app.use(express.urlencoded({ extended: true }));
    app.use(createAdminRoutes(ctx));
  }

  return app;
}

function listen(
  app: express.Express,
  port: number,
  label: string,
  logger: { info: (obj: Record<string, unknown>, msg: string) => void },
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info({ port, label }, `${label} server listening`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
