/**
 * Admin REST API — Hono sub-app mounted at /api/admin.
 * Stateless Basic Auth (admin username + password) on every request.
 * No session cookies, no CSRF.
 */

import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { Logger } from '../logger.ts';
import { verifyPassword } from './repositories/accounts.ts';
import {
  listCredentials,
  getCredentialById,
  createCredential,
  deleteCredential,
  rotateSecret,
  setCredentialScopes,
} from './repositories/credentials.ts';
import type { AdminDeps } from './types.ts';

type AdminApiEnv = {
  Variables: {
    adminAccountId: string;
    adminUsername: string;
    logger: Logger;
  };
};

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

export function createAdminApiApp(deps: AdminDeps): Hono<AdminApiEnv> {
  const app = new Hono<AdminApiEnv>();

  // Inherit per-request logger set by the parent app, fall back to deps
  app.use('*', async (c, next) => {
    if (!c.get('logger')) c.set('logger', deps.logger);
    await next();
  });

  // Basic Auth — required on every request
  app.use('*', async (c, next) => {
    const creds = parseBasicAuth(c.req.header('authorization'));
    if (!creds) {
      c.header('WWW-Authenticate', 'Basic realm="xapi-lrs admin"');
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const account = await verifyPassword(deps.pool, deps.metrics, creds.username, creds.password);
    if (!account) {
      c.header('WWW-Authenticate', 'Basic realm="xapi-lrs admin"');
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('adminAccountId', account.id);
    c.set('adminUsername', account.username);
    await next();
  });

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  // List — secret_key omitted; only shown at create/rotate time.
  // Optional ?api_key=<value> filter for lookup by public key.
  app.get('/credentials', async (c) => {
    const apiKey = c.req.query('api_key');
    const rows = await listCredentials(deps.pool, deps.metrics, apiKey !== undefined ? { apiKey } : {});
    return c.json(rows.map(({ id, api_key, scopes }) => ({ id, api_key, scopes })));
  });

  // Get one — same projection as list; secret_key never returned
  app.get('/credentials/:id', async (c) => {
    const row = await getCredentialById(deps.pool, deps.metrics, c.req.param('id'));
    if (!row) return c.json({ error: 'Not Found' }, 404);
    return c.json({ id: row.id, api_key: row.api_key, scopes: row.scopes });
  });

  // Create — returns secret_key once
  app.post('/credentials', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // empty body or non-JSON — use defaults
    }

    const accountId = typeof body.account_id === 'string' ? body.account_id : c.var.adminAccountId;
    const scopes = Array.isArray(body.scopes) ? (body.scopes as string[]) : [];

    const apiKey = randomBytes(20).toString('hex');
    const secretKey = randomBytes(32).toString('hex');
    const credId = await createCredential(deps.pool, deps.metrics, apiKey, secretKey, accountId);
    if (scopes.length > 0) await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);

    c.var.logger.info(
      { admin: c.var.adminUsername, action: 'credential.create', target: credId },
      'Credential created',
    );
    return c.json({ id: credId, api_key: apiKey, secret_key: secretKey, scopes }, 201);
  });

  // Delete
  app.delete('/credentials/:id', async (c) => {
    const credId = c.req.param('id');
    const found = await deleteCredential(deps.pool, deps.metrics, credId);
    if (!found) return c.json({ error: 'Not Found' }, 404);
    c.var.logger.info(
      { admin: c.var.adminUsername, action: 'credential.delete', target: credId },
      'Credential deleted',
    );
    return new Response(null, { status: 204 });
  });

  // Replace scopes
  app.put('/credentials/:id/scopes', async (c) => {
    const credId = c.req.param('id');
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // treat missing/non-JSON body as empty scopes
    }
    const scopes = Array.isArray(body.scopes) ? (body.scopes as string[]) : [];
    const found = await setCredentialScopes(deps.pool, deps.metrics, credId, scopes);
    if (!found) return c.json({ error: 'Not Found' }, 404);
    c.var.logger.info(
      { admin: c.var.adminUsername, action: 'credential.scopes', target: credId, scopes },
      'Scopes updated',
    );
    return c.json({ scopes });
  });

  // Rotate secret — returns new secret_key once
  app.post('/credentials/:id/rotate', async (c) => {
    const credId = c.req.param('id');
    const newSecret = randomBytes(32).toString('hex');
    const found = await rotateSecret(deps.pool, deps.metrics, credId, newSecret);
    if (!found) return c.json({ error: 'Not Found' }, 404);
    c.var.logger.info({ admin: c.var.adminUsername, action: 'credential.rotate', target: credId }, 'Secret rotated');
    return c.json({ secret_key: newSecret });
  });

  return app;
}
