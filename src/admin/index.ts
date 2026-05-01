/**
 * Admin UI — Hono sub-app mounted at /admin.
 * Server-rendered HTML with htmx for interactivity.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import { XAPI_NOTIFY_CHANNEL, HEARTBEAT_INTERVAL_MS, buildStatementEvent } from '../sse/statement-event.ts';
import type { AdminDeps, AdminEnv } from './types.ts';
export type { AdminEnv, AdminDeps };
import { adminAuthMiddleware, csrfMiddleware } from './middleware.ts';
import { HTMX_JS, HTMX_SSE_JS, PICO_CSS } from './assets.ts';
import {
  getDashboardCounts,
  getRecentStatements,
  listAccounts,
  createAccount,
  deleteAccount,
  changePassword,
  listCredentials,
  createCredential,
  deleteCredential,
  rotateSecret,
  setCredentialScopes,
} from './repositories/index.ts';
import { randomBytes } from 'node:crypto';
import { resolveClientIp } from '../helpers/client-ip.ts';
import { layout } from './views/layout.ts';
import { dashboardPage } from './views/dashboard.ts';
import { metricsPage } from './views/metrics.ts';
import { accountsPage, accountList } from './views/accounts.ts';
import { credentialsPage, rotatedSecret, scopeUpdated, deletedRow } from './views/credentials.ts';
import { streamPage } from './views/stream.ts';
import type { RawHtml } from './views/html.ts';
import { LoginRateLimiter, registerAuthRoutes } from './routes/auth.ts';
import { registerStatementRoutes } from './routes/statements.ts';
import { registerDocumentRoutes } from './routes/documents.ts';

/** Max concurrent admin SSE connections per IP */
const ADMIN_SSE_MAX_PER_IP = 3;

export function createAdminApp(deps: AdminDeps): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const loginLimiter = new LoginRateLimiter();
  const ssePerIpCount = new Map<string, number>();

  // --------------------------------------------------------------------------
  // Per-request logger — inherit child logger from parent app, fall back to deps
  // --------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    if (!c.get('logger')) {
      c.set('logger', deps.logger);
    }
    await next();
  });

  // --------------------------------------------------------------------------
  // Security headers
  // --------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (process.env.NODE_ENV === 'production') {
      c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    await next();
  });

  // --------------------------------------------------------------------------
  // Static assets (public, no auth)
  // --------------------------------------------------------------------------
  app.get('/assets/pico.min.css', (c) => {
    c.header('Cache-Control', 'public, max-age=604800, immutable');
    return c.text(PICO_CSS, 200, { 'Content-Type': 'text/css; charset=utf-8' });
  });
  app.get('/assets/htmx.min.js', (c) => {
    c.header('Cache-Control', 'public, max-age=604800, immutable');
    return c.text(HTMX_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
  });
  app.get('/assets/sse.js', (c) => {
    c.header('Cache-Control', 'public, max-age=604800, immutable');
    return c.text(HTMX_SSE_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
  });

  // --------------------------------------------------------------------------
  // Auth + CSRF middleware
  // --------------------------------------------------------------------------
  app.use('*', adminAuthMiddleware(deps.sessionSecret));
  app.use('*', csrfMiddleware());

  // --------------------------------------------------------------------------
  // Helper: render a page within the layout
  // --------------------------------------------------------------------------
  function renderPage(c: Context<AdminEnv>, content: RawHtml) {
    const session = c.get('adminSession');
    const csrf = c.get('csrfToken');
    return c.html(
      layout({ title: 'Admin', path: c.req.path, username: session.username, csrfToken: csrf }, content).value,
    );
  }

  // --------------------------------------------------------------------------
  // Login / Logout (extracted)
  // --------------------------------------------------------------------------
  registerAuthRoutes(app, deps, loginLimiter);

  // --------------------------------------------------------------------------
  // Dashboard
  // --------------------------------------------------------------------------
  app.get('/', async (c) => {
    const [counts, recent] = await Promise.all([
      getDashboardCounts(deps.pool, deps.metrics),
      getRecentStatements(deps.pool, deps.metrics),
    ]);

    const uptimeMs = Date.now() - deps.startedAt.getTime();
    const hours = Math.floor(uptimeMs / 3_600_000);
    const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return renderPage(c, dashboardPage(counts, recent, uptime));
  });

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------
  app.get('/metrics', async (c) => {
    const rawMetrics = await deps.metrics.getPrometheusText();
    return renderPage(c, metricsPage(rawMetrics));
  });

  app.get('/metrics/raw', async (c) => {
    const content = await deps.metrics.getPrometheusText();
    return c.text(content, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  });

  // --------------------------------------------------------------------------
  // Accounts
  // --------------------------------------------------------------------------
  app.get('/accounts', async (c) => {
    const accounts = await listAccounts(deps.pool, deps.metrics);
    const csrf = c.get('csrfToken');
    return renderPage(c, accountsPage(accounts, csrf));
  });

  app.post('/accounts', async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const session = c.get('adminSession');

    if (!username || !password) {
      return c.text('Username and password are required', 400);
    }
    if (username.length > 64 || password.length > 1024) {
      return c.text('Username or password too long', 400);
    }
    if (password.length < 12) {
      return c.text('Password must be at least 12 characters', 400);
    }

    await createAccount(deps.pool, deps.metrics, username, password);
    c.var.logger.info({ admin: session.username, action: 'account.create', target: username }, 'Admin account created');

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  app.delete('/accounts/:id', async (c) => {
    const accountId = c.req.param('id');
    const session = c.get('adminSession');

    if (accountId === session.accountId) {
      return c.text('Cannot delete your own account', 400);
    }

    await deleteAccount(deps.pool, deps.metrics, accountId);
    c.var.logger.info(
      { admin: session.username, action: 'account.delete', target: accountId },
      'Admin account deleted',
    );

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  app.put('/accounts/:id/password', async (c) => {
    const accountId = c.req.param('id');
    const body = await c.req.parseBody();
    const password = String(body.password ?? '');
    const session = c.get('adminSession');

    if (!password) {
      return c.text('Password is required', 400);
    }
    if (password.length > 1024) {
      return c.text('Password too long', 400);
    }
    if (password.length < 12) {
      return c.text('Password must be at least 12 characters', 400);
    }

    await changePassword(deps.pool, deps.metrics, accountId, password);
    c.var.logger.info(
      { admin: session.username, action: 'account.changePassword', target: accountId },
      'Password changed',
    );

    const accounts = await listAccounts(deps.pool, deps.metrics);
    return c.html(accountList(accounts).value);
  });

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------
  app.get('/credentials', async (c) => {
    const [credentials, accounts] = await Promise.all([
      listCredentials(deps.pool, deps.metrics),
      listAccounts(deps.pool, deps.metrics),
    ]);
    const csrf = c.get('csrfToken');
    return renderPage(c, credentialsPage(credentials, accounts, csrf));
  });

  app.post('/credentials', async (c) => {
    const body = await c.req.parseBody();
    const accountId = String(body.account_id ?? '');
    const scopes = (Array.isArray(body.scopes) ? body.scopes : body.scopes ? [body.scopes] : []) as string[];
    const session = c.get('adminSession');

    if (!accountId) {
      return c.text('Account is required', 400);
    }

    const apiKey = randomBytes(20).toString('hex');
    const secretKey = randomBytes(32).toString('hex');
    const credId = await createCredential(deps.pool, deps.metrics, apiKey, secretKey, accountId);

    if (scopes.length > 0) {
      await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);
    }

    c.var.logger.info({ admin: session.username, action: 'credential.create', target: credId }, 'Credential created');

    // Re-render full page to show the new credential alert
    const [credentials, accounts] = await Promise.all([
      listCredentials(deps.pool, deps.metrics),
      listAccounts(deps.pool, deps.metrics),
    ]);
    const csrf = c.get('csrfToken');
    return renderPage(c, credentialsPage(credentials, accounts, csrf, { apiKey, secretKey }));
  });

  app.delete('/credentials/:id', async (c) => {
    const credId = c.req.param('id');
    const session = c.get('adminSession');

    await deleteCredential(deps.pool, deps.metrics, credId);
    c.var.logger.info({ admin: session.username, action: 'credential.delete', target: credId }, 'Credential deleted');

    return c.html(deletedRow().value);
  });

  app.post('/credentials/:id/rotate', async (c) => {
    const credId = c.req.param('id');
    const session = c.get('adminSession');

    const newSecret = randomBytes(32).toString('hex');
    await rotateSecret(deps.pool, deps.metrics, credId, newSecret);
    c.var.logger.info({ admin: session.username, action: 'credential.rotate', target: credId }, 'Secret rotated');

    return c.html(rotatedSecret(newSecret).value);
  });

  app.put('/credentials/:id/scopes', async (c) => {
    const credId = c.req.param('id');
    const body = await c.req.parseBody();
    const scopes = (Array.isArray(body.scopes) ? body.scopes : body.scopes ? [body.scopes] : []) as string[];
    const session = c.get('adminSession');

    await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);
    c.var.logger.info(
      { admin: session.username, action: 'credential.scopes', target: credId, scopes },
      'Scopes updated',
    );

    return c.html(scopeUpdated().value);
  });

  // --------------------------------------------------------------------------
  // Statements (extracted)
  // --------------------------------------------------------------------------
  registerStatementRoutes(app, deps, renderPage);

  // --------------------------------------------------------------------------
  // Documents (extracted)
  // --------------------------------------------------------------------------
  registerDocumentRoutes(app, deps, renderPage);

  // --------------------------------------------------------------------------
  // Live Stream
  // --------------------------------------------------------------------------
  app.get('/stream', (c) => {
    return renderPage(c, streamPage());
  });

  // SSE endpoint for admin stream page — session-authed, proxies pg_notify events
  app.get('/stream/events', (c) => {
    const ip = resolveClientIp(c.req.header('x-forwarded-for'), deps.trustedProxyHops);
    const ipCount = ssePerIpCount.get(ip) ?? 0;

    if (ipCount >= ADMIN_SSE_MAX_PER_IP) {
      return c.json({ error: 'Too many SSE connections from this IP' }, 429);
    }

    ssePerIpCount.set(ip, ipCount + 1);

    return streamSSE(c, async (stream) => {
      const handler = (payload: string) => {
        void (async () => {
          try {
            const event = await buildStatementEvent(deps.pool, deps.metrics, payload);
            if (!event) return;

            await stream.writeSSE({
              id: event.seq,
              event: 'statement_stored',
              data: JSON.stringify(event),
            });
          } catch (err) {
            c.var.logger.error(err, 'Admin SSE: failed to fetch statement');
          }
        })();
      };

      deps.pgListener.on(XAPI_NOTIFY_CHANNEL, handler);

      stream.onAbort(() => {
        deps.pgListener.off(XAPI_NOTIFY_CHANNEL, handler);
        const remaining = (ssePerIpCount.get(ip) ?? 1) - 1;
        if (remaining <= 0) ssePerIpCount.delete(ip);
        else ssePerIpCount.set(ip, remaining);
      });

      // Heartbeat
      while (true) {
        await stream.write(':heartbeat\n\n');
        await stream.sleep(HEARTBEAT_INTERVAL_MS);
      }
    });
  });

  return app;
}
