/**
 * xAPI 1.0.3 Alternate Request Syntax middleware.
 *
 * Per spec section 1.3, clients that cannot issue PUT/DELETE/GET (e.g. old
 * browsers limited to POST) may instead POST with `?method=PUT` and encode
 * the real payload + headers + query params as form fields.
 *
 * This middleware detects `POST …?method=<VERB>`, rewrites `req.method`,
 * promotes header-like form fields to real headers, rebuilds the URL query
 * string from form fields, and replaces `req.body` with the decoded `content`
 * form field.
 *
 * Must run after `express.urlencoded()` so the form body is already parsed.
 */

import type { Request, Response, NextFunction } from 'express';

/**
 * Form field names that the spec says should be promoted to HTTP headers.
 * Stored lowercase for case-insensitive comparison.
 */
const HEADER_FIELDS = new Set([
  'authorization',
  'x-experience-api-version',
  'content-type',
  'content-length',
  'if-match',
  'if-none-match',
]);

const VALID_METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE']);

export function xapiAlternateSyntaxMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only applies to POST requests with a `method` query parameter
  if (req.method !== 'POST' || typeof req.query['method'] !== 'string') {
    next();
    return;
  }

  const targetMethod = req.query['method'].toUpperCase();
  if (!VALID_METHODS.has(targetMethod)) {
    res.status(400).json({
      error: {
        status: 400,
        code: 'BAD_REQUEST',
        message: `Invalid method parameter: ${req.query['method']}`,
      },
    });
    return;
  }

  // xAPI §1.3: reject alternate requests with extra query params beyond "method"
  const extraQueryParams = Object.keys(req.query).filter((k) => k !== 'method');
  if (extraQueryParams.length > 0) {
    res.status(400).json({
      error: {
        status: 400,
        code: 'BAD_REQUEST',
        message: `Alternate request syntax must not include extra query parameters: ${extraQueryParams.join(', ')}`,
      },
    });
    return;
  }

  // Rewrite the HTTP method
  req.method = targetMethod;

  // The body must be a parsed urlencoded object (from express.urlencoded)
  const body = req.body as Record<string, string> | undefined;
  if (!body || typeof body !== 'object') {
    // Remove `method` from query by rewriting the URL
    rewriteUrl(req, {});
    next();
    return;
  }

  // 1. Promote header fields from form body to real headers
  for (const [key, value] of Object.entries(body)) {
    if (HEADER_FIELDS.has(key.toLowerCase()) && typeof value === 'string') {
      req.headers[key.toLowerCase()] = value;
    }
  }

  // 2. Extract `content` form field — this is the real request body
  const rawContent = body['content'];

  // 3. Remaining form fields (not headers, not `content`, not `method`) become query params
  const newQuery: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'content' || key === 'method') continue;
    if (HEADER_FIELDS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') {
      newQuery[key] = value;
    }
  }
  rewriteUrl(req, newQuery);

  // 4. Replace req.body with the decoded content
  // The promoted Content-Type header tells downstream parsers how to interpret it.
  // If no Content-Type was promoted, try JSON if the content looks like JSON.
  if (rawContent !== undefined) {
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    const looksLikeJson = rawContent.startsWith('{') || rawContent.startsWith('[');
    if (contentType.includes('application/json') || looksLikeJson) {
      try {
        req.body = JSON.parse(rawContent);
        if (!contentType.includes('application/json')) {
          req.headers['content-type'] = 'application/json';
        }
      } catch {
        res.status(400).json({
          error: {
            status: 400,
            code: 'BAD_REQUEST',
            message: 'Invalid JSON in content form parameter',
          },
        });
        return;
      }
    } else {
      // For document endpoints (state, profiles), body should be a Buffer
      req.body = Buffer.from(rawContent, 'utf-8');
    }
  } else {
    req.body = undefined;
  }

  next();
}

/**
 * Rewrite `req.url` so that `req.query` (a getter in Express 5 that
 * derives from the URL) reflects the new query parameters.
 */
function rewriteUrl(req: Request, queryParams: Record<string, string>): void {
  const pathname = req.url.split('?')[0] ?? req.url;
  const qs = new URLSearchParams(queryParams).toString();
  req.url = qs ? `${pathname}?${qs}` : pathname;
}
