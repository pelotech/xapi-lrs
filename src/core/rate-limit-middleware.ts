import type { Request, Response, NextFunction } from 'express';
import type { AppContext } from './context.js';
import type { SlidingWindowRateLimiter } from './rate-limit.js';

function send429(res: Response, retryAfterSec: number, requestId: string): void {
  res.setHeader('Retry-After', String(retryAfterSec));
  res.status(429).json({
    error: {
      status: 429,
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ${String(retryAfterSec)} seconds.`,
      requestId,
    },
  });
}

/**
 * Layer 1 — Global IP rate limiter (pre-auth).
 * Rejects before body parsers to avoid wasting cycles on large bodies.
 */
export function ipRateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.app.locals['ctx'] as AppContext;
    const limiter = ctx.rateLimiters.ip;
    const result = limiter.check(req.ip ?? '0.0.0.0');

    if (!result.allowed) {
      ctx.metrics.rateLimitHitsTotal.inc({ layer: 'ip' });
      const requestId = String(req.id ?? 'unknown');
      send429(res, result.retryAfterSec, requestId);
      return;
    }

    next();
  };
}

/**
 * Layer 2 — Per-tenant rate limiter (post-auth).
 * Called inside expressAuthentication() after tenant resolution.
 * Throws an error caught by the central error handler.
 */
export function checkTenantRateLimit(
  limiter: SlidingWindowRateLimiter,
  tenantId: string,
): void {
  const result = limiter.check(tenantId);
  if (!result.allowed) {
    const err = new Error(
      `Too many requests. Try again in ${String(result.retryAfterSec)} seconds.`,
    );
    (err as unknown as Record<string, unknown>).status = 429;
    (err as unknown as Record<string, unknown>).code = 'RATE_LIMITED';
    (err as unknown as Record<string, unknown>).retryAfterSec = result.retryAfterSec;
    throw err;
  }
}

/**
 * Layer 3a — Admin general rate limiter.
 */
export function adminRateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.app.locals['ctx'] as AppContext;
    const limiter = ctx.rateLimiters.admin;
    const result = limiter.check(req.ip ?? '0.0.0.0');

    if (!result.allowed) {
      ctx.metrics.rateLimitHitsTotal.inc({ layer: 'admin' });
      const requestId = String(req.id ?? 'unknown');
      send429(res, result.retryAfterSec, requestId);
      return;
    }

    next();
  };
}

/**
 * Layer 3b — Admin login brute-force protection.
 */
export function adminLoginRateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.app.locals['ctx'] as AppContext;
    const limiter = ctx.rateLimiters.adminLogin;
    const result = limiter.check(req.ip ?? '0.0.0.0');

    if (!result.allowed) {
      ctx.metrics.rateLimitHitsTotal.inc({ layer: 'admin_login' });
      const requestId = String(req.id ?? 'unknown');
      send429(res, result.retryAfterSec, requestId);
      return;
    }

    next();
  };
}
