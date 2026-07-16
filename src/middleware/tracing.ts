/**
 * HTTP tracing middleware for the xAPI data plane.
 *
 * Emits one SERVER span per request, named `<METHOD> <matched-route>` (e.g.
 * `GET /xapi/statements/:id`). Extracts an incoming W3C trace context (if
 * present) so this span nests under an upstream caller's trace. Mount on
 * `/xapi/*` when tracing is enabled (see src/tracing.ts).
 */

import { context, propagation, trace, SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';
import { safeRoutePath } from '../helpers/route-path.ts';
import type { HonoEnv } from '../hono-env.ts';

// TextMapGetter for a Fetch `Headers` carrier.
const headersGetter = {
  get: (h: Headers, k: string) => h.get(k) ?? undefined,
  keys: (h: Headers) => [...h.keys()],
};

/** SERVER-span middleware for the xAPI data plane. Mount on `/xapi/*` when tracing is enabled. */
export function tracingMiddleware(tracer: Tracer): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const parentCtx = propagation.extract(context.active(), c.req.raw.headers, headersGetter);
    // Provisional name — the matched route is unknown until next() runs.
    const span = tracer.startSpan(c.req.method, { kind: SpanKind.SERVER }, parentCtx);
    const activeCtx = trace.setSpan(parentCtx, span);
    try {
      await context.with(activeCtx, next);
      // Hono's compose() catches handler exceptions at each dispatch layer and
      // routes them through the app's error handler before they can bubble up
      // here, so `await next()` resolves normally even when a downstream
      // handler threw. The caught error is exposed via `c.error` instead.
      if (c.error) {
        span.recordException(c.error);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
    } catch (err) {
      // Defensive fallback for errors thrown before Hono's compose() can
      // convert them into `c.error` (e.g. a throw in this middleware itself).
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      const route = safeRoutePath(c);
      span.updateName(`${c.req.method} ${route}`);
      span.setAttribute('http.request.method', c.req.method);
      span.setAttribute('http.route', route);
      span.setAttribute('url.path', c.req.path);
      span.setAttribute('http.response.status_code', c.res.status);
      const xapiVersion = c.get('xapiVersion');
      if (xapiVersion) span.setAttribute('xapi.version', xapiVersion);
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  };
}
