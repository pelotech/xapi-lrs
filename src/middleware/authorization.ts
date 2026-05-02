/**
 * xAPI Scope Authorization Middleware
 *
 * Enforces credential scopes on xAPI endpoints.
 * Must run AFTER authentication middleware (c.var.auth must be set).
 *
 * Scope model follows the xAPI / lrsql convention:
 *   - all              — unrestricted
 *   - all/read         — read-only on all resources
 *   - statements/write — POST/PUT /xapi/statements
 *   - statements/read  — GET /xapi/statements (all)
 *   - statements/read/mine — GET /xapi/statements (own only, not enforced here)
 *   - state            — CRUD /xapi/activities/state
 *   - state/read       — read-only /xapi/activities/state
 *   - profile          — CRUD /xapi/activities/profile, /xapi/agents/profile
 *   - define           — write activity definitions (via profile endpoints)
 */

import type { MiddlewareHandler } from 'hono';
import type { XapiScope } from '../auth/types.ts';
import { HttpError } from '../db.ts';
import type { HonoEnv } from '../hono-env.ts';

type ScopeRule = { scopes: ReadonlyArray<XapiScope> };

/** Routes that bypass scope checks (no auth required). */
const PUBLIC_PATHS = new Set(['/xapi/about']);

/**
 * Resolve which scopes are acceptable for a given path + method.
 * Returns null if the route is public or unknown (let it through).
 */
export function requiredScopes(path: string, method: string): ScopeRule | null {
  const isRead = method === 'GET' || method === 'HEAD';

  // /xapi/statements
  if (path === '/xapi/statements') {
    if (isRead) {
      return { scopes: ['statements/read', 'statements/read/mine', 'all/read', 'all'] };
    }
    // POST, PUT
    return { scopes: ['statements/write', 'all'] };
  }

  // /xapi/activities/state
  if (path === '/xapi/activities/state') {
    if (isRead) {
      return { scopes: ['state', 'state/read', 'all/read', 'all'] };
    }
    // PUT, POST, DELETE
    return { scopes: ['state', 'all'] };
  }

  // /xapi/activities/profile
  if (path === '/xapi/activities/profile') {
    if (isRead) {
      return { scopes: ['profile', 'all/read', 'all'] };
    }
    return { scopes: ['profile', 'define', 'all'] };
  }

  // /xapi/agents/profile
  if (path === '/xapi/agents/profile') {
    if (isRead) {
      return { scopes: ['profile', 'all/read', 'all'] };
    }
    return { scopes: ['profile', 'all'] };
  }

  // /xapi/agents (GET only)
  if (path === '/xapi/agents') {
    return { scopes: ['profile', 'all/read', 'all'] };
  }

  // /xapi/activities (GET only — activity definition lookup)
  if (path === '/xapi/activities') {
    return { scopes: ['profile', 'all/read', 'all'] };
  }

  // /xapi/stream (SSE — real-time statement feed)
  if (path === '/xapi/stream') {
    return { scopes: ['statements/read', 'statements/read/mine', 'all/read', 'all'] };
  }

  return null;
}

export function hasScope(granted: ReadonlyArray<XapiScope>, required: ReadonlyArray<XapiScope>): boolean {
  return required.some((s) => granted.includes(s));
}

/**
 * Middleware that enforces xAPI scopes based on path and HTTP method.
 * Must be mounted AFTER authMiddleware.
 */
export function scopeMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const path = c.req.path;

    if (PUBLIC_PATHS.has(path)) {
      return next();
    }

    const rule = requiredScopes(path, c.req.method);
    if (!rule) {
      // Unknown route or no scope restriction — let it through
      return next();
    }

    const auth = c.var.auth;
    if (!auth) {
      throw new HttpError(401, 'Unauthorized');
    }

    if (!hasScope(auth.payload.scopes, rule.scopes)) {
      throw new HttpError(403, 'Insufficient scope');
    }

    return next();
  };
}
