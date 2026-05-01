/**
 * Admin auth routes — login, logout, rate limiting.
 */

import type { Hono } from 'hono';
import type { AdminSession, AdminEnv, AdminDeps } from '../types.ts';
import { createSession, clearSession } from '../middleware.ts';
import { verifyPassword } from '../repositories/index.ts';
import { resolveClientIp } from '../../helpers/client-ip.ts';
import { loginPage } from '../views/login.ts';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export class LoginRateLimiter {
  private attempts = new Map<string, number[]>();

  /** Interval handle for periodic pruning of stale keys */
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Prune stale keys every 5 minutes to prevent unbounded memory growth
    this.pruneTimer = setInterval(() => this.pruneStaleKeys(), 5 * 60 * 1000);
    if (this.pruneTimer && typeof this.pruneTimer === 'object' && 'unref' in this.pruneTimer) {
      this.pruneTimer.unref();
    }
  }

  isBlocked(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(ip);
    if (!timestamps) return false;
    const recent = timestamps.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length === 0) {
      this.attempts.delete(ip);
      return false;
    }
    this.attempts.set(ip, recent);
    return recent.length >= LOGIN_MAX_ATTEMPTS;
  }

  recordFailure(ip: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(ip) ?? [];
    timestamps.push(now);
    this.attempts.set(ip, timestamps);
  }

  reset(ip: string): void {
    this.attempts.delete(ip);
  }

  private pruneStaleKeys(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((t) => now - t < LOGIN_WINDOW_MS);
      if (recent.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recent);
      }
    }
  }
}

export function registerAuthRoutes(app: Hono<AdminEnv>, deps: AdminDeps, loginLimiter: LoginRateLimiter): void {
  app.get('/login', (c) => {
    return c.html(loginPage().value);
  });

  app.post('/login', async (c) => {
    const ip = resolveClientIp(c.req.header('x-forwarded-for'), deps.trustedProxyHops);
    if (loginLimiter.isBlocked(ip)) {
      c.var.logger.warn({ ip, action: 'login.rate_limited' }, 'Admin login rate limited');
      return c.html(loginPage('Too many login attempts. Try again later.').value, 429);
    }

    const body = await c.req.parseBody();
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');

    if (!username || !password) {
      return c.html(loginPage('Username and password are required').value, 400);
    }
    if (username.length > 64 || password.length > 1024) {
      return c.html(loginPage('Username or password too long').value, 400);
    }

    const account = await verifyPassword(deps.pool, deps.metrics, username, password);
    if (!account) {
      loginLimiter.recordFailure(ip);
      c.var.logger.info({ admin: username, action: 'login.failed' }, 'Admin login failed');
      return c.html(loginPage('Invalid username or password').value, 401);
    }

    loginLimiter.reset(ip);
    const session: AdminSession = {
      accountId: account.id,
      username: account.username,
      exp: Date.now() + 900_000, // 15 min (sliding window renews on each request)
    };

    createSession(c, session, deps.sessionSecret);
    c.var.logger.info({ admin: username, action: 'login.success' }, 'Admin login');
    return c.redirect('/admin');
  });

  app.post('/logout', (c) => {
    const session = c.get('adminSession');
    if (session) {
      c.var.logger.info({ admin: session.username, action: 'logout' }, 'Admin logout');
    }
    clearSession(c);
    return c.redirect('/admin/login');
  });
}
