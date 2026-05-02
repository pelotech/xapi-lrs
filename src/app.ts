/**
 * Hono application factory for the LRS service.
 * Creates and configures the Hono app with xAPI middleware and OpenAPI routes.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import type { DbPool } from './db.ts';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { HonoEnv } from './hono-env.ts';
import type { Logger } from './logger.ts';
import type { LrsMetrics } from './metrics.ts';
import type { LrsConfig } from './config.ts';
import type { JwksCache, JwtConfig } from './auth/jwt.ts';
import type { LrsDeps } from './deps.ts';
import type { Listener } from './sse/pg-listener.ts';
import { randomUUID } from 'node:crypto';
import { HttpError } from './db.ts';
import { authMiddleware } from './middleware/authentication.ts';
import { scopeMiddleware } from './middleware/authorization.ts';
import { rateLimitMiddleware } from './middleware/rate-limit.ts';
import { createAboutApp } from './routes/about.ts';
import { createStatementsApp } from './routes/statements.ts';
import { createActivitiesApp } from './routes/activities.ts';
import { createAgentsApp } from './routes/agents.ts';
import { createSseRoute } from './sse/sse-producer.ts';
import { parseMultipartMixed, extractBoundary } from './xapi/multipart.ts';
import { createAdminApp } from './admin/index.ts';

// ============================================================================
// xAPI Alternate Request Syntax (§1.3) — header fields allowed in form body
// ============================================================================

const ALTERNATE_HEADER_FIELDS = new Set([
  'Authorization',
  'X-Experience-API-Version',
  'Content-Type',
  'Content-Length',
  'If-Match',
  'If-None-Match',
]);

// ============================================================================
// App Factory
// ============================================================================

export interface AppDeps {
  config: LrsConfig;
  pool: DbPool;
  jwksCache: JwksCache;
  jwtConfig: JwtConfig | null;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: Listener;
  sessionSecret: string;
  startedAt: Date;
}

export function createApp(deps: AppDeps): OpenAPIHono<HonoEnv> {
  const app = new OpenAPIHono<HonoEnv>();

  const lrsDeps: LrsDeps = {
    pool: deps.pool,
    metrics: deps.metrics,
    logger: deps.logger,
    jwksCache: deps.jwksCache,
    jwtConfig: deps.jwtConfig,
    xapiVerifySignatures: deps.config.xapiVerifySignatures,
  };

  // --------------------------------------------------------------------------
  // Error handler
  // --------------------------------------------------------------------------

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    if ('status' in err && typeof (err as Record<string, unknown>).status === 'number') {
      const status = (err as Record<string, unknown>).status as number;
      return c.json({ error: err.message || 'Authentication failed' }, status as ContentfulStatusCode);
    }
    const log = c.get('logger') ?? deps.logger;
    log.error(err, 'Unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // --------------------------------------------------------------------------
  // Request ID — propagate or generate a unique trace identifier
  // --------------------------------------------------------------------------

  app.use('*', async (c, next) => {
    const id = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', id);
    c.set('logger', deps.logger.child({ requestId: id }));
    c.header('X-Request-ID', id);
    await next();
  });

  // --------------------------------------------------------------------------
  // Structured request logging
  // --------------------------------------------------------------------------

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const auth = c.get('auth') as HonoEnv['Variables']['auth'] | undefined;
    const identity =
      auth?.type === 'basic' ? auth.payload.accountName : auth?.type === 'jwt' ? auth.payload.sub : undefined;
    const log = c.get('logger') ?? deps.logger;
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        query: c.req.query(),
        status: c.res.status,
        duration,
        identity,
      },
      `${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`,
    );
  });

  // --------------------------------------------------------------------------
  // Security headers
  // --------------------------------------------------------------------------

  app.use('/xapi/*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    if (deps.config.nodeEnv === 'production') {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    return next();
  });

  // --------------------------------------------------------------------------
  // Deps injection — make LrsDeps available to all route handlers
  // --------------------------------------------------------------------------

  app.use('/xapi/*', async (c, next) => {
    c.set('deps', { ...lrsDeps, logger: c.get('logger') ?? lrsDeps.logger });
    await next();
  });

  // --------------------------------------------------------------------------
  // CORS — skip when handled by reverse proxy (CORS_ENABLED=false)
  // --------------------------------------------------------------------------

  if (deps.config.corsEnabled) {
    app.use(
      '/xapi/*',
      cors({
        origin: deps.config.corsOrigin,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'X-Experience-API-Version', 'If-Match', 'If-None-Match'],
        exposeHeaders: ['ETag', 'Last-Modified', 'X-Experience-API-Version', 'X-Experience-API-Consistent-Through'],
      }),
    );
  }

  // --------------------------------------------------------------------------
  // Alternate Request Syntax (xAPI §1.3)
  //
  // POST /xapi/…?method=GET|PUT|DELETE with form-encoded body.
  // Header fields and query params are extracted from the form body.
  // We re-dispatch with the correct HTTP method via app.fetch().
  //
  // Security note: per xAPI 1.0.3 §1.3 the form body may override
  // Authorization and other headers. This is spec-required behavior —
  // the auth middleware will validate the overridden credentials normally.
  // --------------------------------------------------------------------------

  app.use('/xapi/*', async (c, next) => {
    if (c.req.method !== 'POST') return next();

    const methodOverride = c.req.query('method')?.toUpperCase();
    if (!methodOverride || !['GET', 'PUT', 'DELETE'].includes(methodOverride)) return next();

    const ct = c.req.header('content-type') ?? '';
    if (!ct.includes('application/x-www-form-urlencoded')) return next();

    // Parse form body
    const formText = await c.req.text();
    const formParams = new URLSearchParams(formText);
    const formData: Record<string, string> = {};
    for (const [k, v] of formParams) {
      formData[k] = v;
    }

    // Build new URL without ?method=
    const url = new URL(c.req.url);
    url.searchParams.delete('method');

    // Check for duplicate params between URL query and form body
    for (const key of url.searchParams.keys()) {
      if (key !== 'method' && key in formData) {
        return c.json({ error: `Duplicate parameter in query string and body: ${key}` }, 400);
      }
    }

    // Extract header fields from form body and apply to new request
    const newHeaders = new Headers(c.req.raw.headers);
    for (const headerName of ALTERNATE_HEADER_FIELDS) {
      if (formData[headerName]) {
        newHeaders.set(headerName.toLowerCase(), formData[headerName]);
      }
    }

    // Move non-header, non-content fields from form body to query string
    for (const [key, value] of Object.entries(formData)) {
      if (!ALTERNATE_HEADER_FIELDS.has(key) && key !== 'content') {
        url.searchParams.set(key, value);
      }
    }

    // Content-Length from the original form POST is wrong for the re-dispatched request
    newHeaders.delete('content-length');

    // Build new request with overridden method
    const reqInit: RequestInit = {
      method: methodOverride,
      headers: newHeaders,
    };

    // Include body for methods that support it
    if ((methodOverride === 'PUT' || methodOverride === 'POST') && formData.content) {
      reqInit.body = formData.content;
      // Default to application/json when form body didn't specify Content-Type
      if (!formData['Content-Type']) {
        newHeaders.set('content-type', 'application/json');
      }
    } else if (methodOverride === 'GET' || methodOverride === 'DELETE') {
      // No body for GET/DELETE — remove content headers
      newHeaders.delete('content-type');
    }

    const newReq = new Request(url.toString(), reqInit);
    return app.fetch(newReq);
  });

  // --------------------------------------------------------------------------
  // xAPI Version Header Validation (§3.2)
  // --------------------------------------------------------------------------

  app.use('/xapi/*', async (c, next) => {
    const version = c.req.header('x-experience-api-version');
    const path = c.req.path;

    // /about and /stream: version header is optional but must be 1.0.x if present
    if (path === '/xapi/about' || path === '/xapi/stream') {
      if (version && !version.startsWith('1.0')) {
        return c.json({ error: `Unsupported xAPI version: ${version}` }, 400);
      }
      c.header('X-Experience-API-Version', '1.0.3');
      return next();
    }

    // All other xAPI routes: version header is required
    c.header('X-Experience-API-Version', '1.0.3');

    if (!version) {
      return c.json({ error: 'X-Experience-API-Version header is required' }, 400);
    }
    if (!version.startsWith('1.0')) {
      return c.json({ error: `Unsupported xAPI version: ${version}` }, 400);
    }
    return next();
  });

  // --------------------------------------------------------------------------
  // Request body size limit — reject oversized payloads before reading
  // --------------------------------------------------------------------------

  const maxBody = deps.config.maxRequestBodyBytes;
  app.use('/xapi/*', async (c, next) => {
    const cl = c.req.header('content-length');
    if (cl) {
      const len = Number(cl);
      if (!Number.isNaN(len) && len > maxBody) {
        return c.json({ error: 'Request body too large' }, 413);
      }
    }
    return next();
  });

  // --------------------------------------------------------------------------
  // Body parsing: read raw body and parse JSON/multipart
  // --------------------------------------------------------------------------

  app.use('/xapi/*', async (c, next) => {
    // No body for safe methods
    if (c.req.method === 'GET' || c.req.method === 'DELETE' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
      c.set('parsedBody', undefined);
      c.set('rawBody', Buffer.alloc(0));
      c.set('attachmentParts', undefined);
      return next();
    }

    const ct = c.req.header('content-type') ?? '';

    // Read raw body once and store it
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (raw.length > maxBody) {
      return c.json({ error: 'Request body too large' }, 413);
    }
    c.set('rawBody', raw);

    if (ct.includes('multipart/mixed')) {
      const boundary = extractBoundary(ct);
      if (boundary) {
        try {
          const result = parseMultipartMixed(raw, boundary);
          c.set('parsedBody', result.json);
          c.set('attachmentParts', result.attachments);
        } catch (err) {
          throw err instanceof Error ? new HttpError(400, err.message) : err;
        }
      } else {
        c.set('parsedBody', undefined);
        c.set('attachmentParts', undefined);
      }
    } else if (ct.includes('application/json')) {
      try {
        c.set('parsedBody', JSON.parse(raw.toString('utf8')));
      } catch {
        throw new HttpError(400, 'Invalid JSON in request body');
      }
      c.set('attachmentParts', undefined);
    } else {
      c.set('parsedBody', undefined);
      c.set('attachmentParts', undefined);
    }

    return next();
  });

  // --------------------------------------------------------------------------
  // Authentication — skip for /about only
  // --------------------------------------------------------------------------

  const auth = authMiddleware();
  app.use('/xapi/*', async (c, next) => {
    if (c.req.path === '/xapi/about') {
      return next();
    }
    return auth(c, next);
  });

  // --------------------------------------------------------------------------
  // Scope authorization — enforce credential scopes on xAPI routes
  // --------------------------------------------------------------------------

  app.use('/xapi/*', scopeMiddleware());

  // --------------------------------------------------------------------------
  // Rate limiting — per-credential/IP sliding window
  // --------------------------------------------------------------------------

  app.use(
    '/xapi/*',
    rateLimitMiddleware({
      windowSeconds: deps.config.xapiRateLimitWindow,
      maxRequests: deps.config.xapiRateLimitMax,
      trustedProxyHops: deps.config.trustedProxyHops,
    }),
  );

  // --------------------------------------------------------------------------
  // Mount route sub-apps
  // --------------------------------------------------------------------------

  app.route('/xapi', createAboutApp());
  app.route('/xapi', createStatementsApp());
  app.route('/xapi', createActivitiesApp());
  app.route('/xapi', createAgentsApp());
  app.route(
    '/xapi',
    createSseRoute({
      pool: deps.pool,
      metrics: deps.metrics,
      logger: deps.logger,
      pgListener: deps.pgListener,
      maxConnectionsGlobal: deps.config.sseMaxConnectionsGlobal,
      maxConnectionsPerIp: deps.config.sseMaxConnectionsPerIp,
      trustedProxyHops: deps.config.trustedProxyHops,
    }),
  );

  // --------------------------------------------------------------------------
  // OpenAPI spec endpoint
  // --------------------------------------------------------------------------

  app.openAPIRegistry.registerComponent('securitySchemes', 'basic', {
    type: 'http',
    scheme: 'basic',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'jwt', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  // Only expose OpenAPI spec in non-production environments
  if (deps.config.nodeEnv !== 'production') {
    app.doc('/xapi/openapi.json', {
      openapi: '3.0.0',
      info: {
        title: 'xapi-lrs',
        version: '1.0.0',
        description:
          'xAPI Learning Record Store — standalone service for xAPI statement storage and document resources',
      },
      servers: [{ url: '/' }],
    });
  }

  // --------------------------------------------------------------------------
  // Mount Admin UI at /admin
  // --------------------------------------------------------------------------

  const adminApp = createAdminApp({
    pool: deps.pool,
    metrics: deps.metrics,
    logger: deps.logger,
    pgListener: deps.pgListener,
    sessionSecret: deps.sessionSecret,
    startedAt: deps.startedAt,
    trustedProxyHops: deps.config.trustedProxyHops,
  });
  app.route('/admin', adminApp);

  return app;
}
