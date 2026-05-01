/**
 * Admin UI middleware — session auth (HMAC-signed cookie) + CSRF double-submit.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AdminSession } from './types.ts';

const SESSION_COOKIE = 'admin_session';
const CSRF_COOKIE = 'admin_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SESSION_MAX_AGE_S = 900; // 15 minutes (sliding window — renewed on each request)

// ============================================================================
// HMAC-signed cookie helpers
// ============================================================================

function sign(payload: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(cookie: string, secret: string): string | null {
  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  return payload;
}

// ============================================================================
// Session management
// ============================================================================

export function createSession(
  c: { header: (name: string, value: string) => void },
  session: AdminSession,
  secret: string,
): void {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signed = sign(payload, secret);
  // Set cookie via raw header to control SameSite
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${signed}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
  );
}

export function clearSession(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/admin' });
}

function parseSession(raw: string | undefined, secret: string): AdminSession | null {
  if (!raw) return null;
  const payload = verify(raw, secret);
  if (!payload) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AdminSession;
    if (session.exp && session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// ============================================================================
// CSRF double-submit cookie
// ============================================================================

function ensureCsrfToken(c: Parameters<typeof getCookie>[0] & Parameters<typeof setCookie>[0]): string {
  const existing = getCookie(c, CSRF_COOKIE);
  if (existing) return existing;
  const token = randomBytes(24).toString('base64url');
  setCookie(c, CSRF_COOKIE, token, {
    path: '/admin',
    sameSite: 'Lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });
  return token;
}

/** Constant-time CSRF token comparison to prevent timing attacks. */
function csrfTokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ============================================================================
// Middleware
// ============================================================================

/** Session auth middleware — protects all admin routes except login + assets. */
export function adminAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;

    // Public routes: login page, login POST, assets
    if (path === '/admin/login' || path.startsWith('/admin/assets/')) {
      return next();
    }

    const raw = getCookie(c, SESSION_COOKIE);
    const session = parseSession(raw, secret);
    if (!session) {
      // For htmx requests, return 401 so client-side can redirect
      if (c.req.header('hx-request')) {
        c.header('HX-Redirect', '/admin/login');
        return c.text('Unauthorized', 401);
      }
      return c.redirect('/admin/login');
    }

    // Sliding window: renew session expiry on each authenticated request
    session.exp = Date.now() + SESSION_MAX_AGE_S * 1000;
    createSession(c, session, secret);

    c.set('adminSession' as never, session);
    return next();
  };
}

/** CSRF middleware — validates double-submit token on mutating requests. */
export function csrfMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Ensure a CSRF token cookie exists on every request
    const token = ensureCsrfToken(c);
    c.set('csrfToken' as never, token);

    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    // Skip CSRF check on login POST (no session yet, no token to validate)
    if (c.req.path === '/admin/login') {
      return next();
    }

    // Validate: header or form field must match cookie
    const headerToken = c.req.header(CSRF_HEADER);
    if (headerToken && csrfTokensMatch(headerToken, token)) {
      return next();
    }

    // Check _csrf form field for non-htmx form submissions
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      try {
        const body = await c.req.parseBody();
        if (typeof body._csrf === 'string' && csrfTokensMatch(body._csrf, token)) {
          return next();
        }
      } catch {
        // Fall through to CSRF mismatch
      }
    }

    return c.text('CSRF token mismatch', 403);
  };
}
