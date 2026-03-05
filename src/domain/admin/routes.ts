import { Router, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { AppContext } from '../../core/context.js';
import { adminAuth } from './middleware.js';
import { render } from './views/helpers.js';
import { layout } from './views/layout.js';
import { loginPage } from './views/login.js';
import { dashboardPage } from './views/dashboard.js';
import { tenantsPage } from './views/tenants-list.js';
import { tokensPage } from './views/tokens-list.js';
import { statementsPage, statementDetail } from './views/statements-list.js';
import { forwardingPage } from './views/forwarding.js';
import crypto from 'node:crypto';
import {
  getDashboardStats,
  listTenants,
  listTenantOptions,
  listTokens,
  listStatements,
  getStatementRaw,
  listForwardTargets,
  upsertForwardTarget,
  deleteForwardTarget,
  createToken,
  deleteToken,
} from './queries.js';
import { VALID_SCOPES } from '../xapi/xapi-scopes.js';

export function createAdminRoutes(ctx: AppContext): Router {
  const { config, pool } = ctx;
  const router = Router();

  router.use(cookieParser());
  router.use(adminAuth(config));

  // --- Login ---
  router.get('/admin/login', (_req: Request, res: Response) => {
    res.type('html').send(loginPage());
  });

  router.post('/admin/login', (req: Request, res: Response) => {
    const secret = (req.body as { secret?: string })?.secret;
    if (secret === config.ADMIN_SECRET) {
      res.cookie('admin_session', secret, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
      res.redirect('/admin');
      return;
    }
    res.type('html').status(401).send(loginPage('Invalid secret'));
  });

  router.get('/admin/logout', (_req: Request, res: Response) => {
    res.clearCookie('admin_session');
    res.redirect('/admin/login');
  });

  // --- Dashboard ---
  router.get('/admin', async (req: Request, res: Response) => {
    const stats = await getDashboardStats(pool);
    const html = render(req, dashboardPage(stats), layout);
    res.type('html').send(html);
  });

  // --- Tenants ---
  router.get('/admin/tenants', async (req: Request, res: Response) => {
    const tenants = await listTenants(pool);
    const html = render(req, tenantsPage(tenants), layout);
    res.type('html').send(html);
  });

  // --- Tokens ---
  router.get('/admin/tokens', async (req: Request, res: Response) => {
    const search = (req.query['search'] as string) ?? '';
    const [tokens, tenants] = await Promise.all([
      listTokens(pool, { search, limit: 50, offset: 0 }),
      listTenantOptions(pool),
    ]);
    const html = render(req, tokensPage(tokens, search, tenants), layout);
    res.type('html').send(html);
  });

  router.post('/admin/tokens', async (req: Request, res: Response) => {
    const body = req.body as {
      tenantId?: string;
      userSub?: string;
      scopes?: string | string[];
    };

    if (!body.tenantId || !body.userSub) {
      res.status(400).type('html').send('Missing tenantId or userSub');
      return;
    }

    const scopes = Array.isArray(body.scopes)
      ? body.scopes
      : body.scopes
        ? [body.scopes]
        : [];

    if (scopes.length === 0) {
      res.status(400).type('html').send('At least one scope is required');
      return;
    }

    const invalidScopes = scopes.filter(
      (s) => !VALID_SCOPES.includes(s as typeof VALID_SCOPES[number]),
    );
    if (invalidScopes.length > 0) {
      res
        .status(400)
        .type('html')
        .send(`Invalid scopes: ${invalidScopes.join(', ')}`);
      return;
    }

    const secret = crypto.randomBytes(32).toString('base64url');
    const { rows } = await pool.query<{ hash: string }>(
      `SELECT crypt($1, gen_salt('bf')) AS hash`,
      [secret],
    );
    const secretHash = rows[0]!.hash;

    const id = await createToken(pool, body.tenantId, body.userSub, secretHash, scopes);

    const search = '';
    const [tokens, tenants] = await Promise.all([
      listTokens(pool, { search, limit: 50, offset: 0 }),
      listTenantOptions(pool),
    ]);
    const html = render(
      req,
      tokensPage(tokens, search, tenants, { id, secret }),
      layout,
    );
    res.type('html').send(html);
  });

  router.delete('/admin/tokens/:id', async (req: Request, res: Response) => {
    await deleteToken(pool, req.params['id'] as string);

    const search = '';
    const [tokens, tenants] = await Promise.all([
      listTokens(pool, { search, limit: 50, offset: 0 }),
      listTenantOptions(pool),
    ]);
    const html = render(req, tokensPage(tokens, search, tenants), layout);
    res.type('html').send(html);
  });

  // --- Statements ---
  router.get('/admin/statements', async (req: Request, res: Response) => {
    const q = req.query;
    const filters = {
      tenantId: (q['tenantId'] as string) || undefined,
      verbId: (q['verbId'] as string) || undefined,
      actorIfi: (q['actorIfi'] as string) || undefined,
      activityId: (q['activityId'] as string) || undefined,
      since: (q['since'] as string) || undefined,
      limit: Math.min(Number(q['limit']) || 50, 200),
      offset: Math.max(Number(q['offset']) || 0, 0),
    };
    const [result, tenants] = await Promise.all([
      listStatements(pool, filters),
      listTenantOptions(pool),
    ]);
    const html = render(
      req,
      statementsPage(result.rows, filters, tenants, result.total),
      layout,
    );
    res.type('html').send(html);
  });

  router.get('/admin/statements/:id', async (req: Request, res: Response) => {
    const raw = await getStatementRaw(pool, req.params['id'] as string);
    if (!raw) {
      res.status(404).type('html').send('<td colspan="7">Not found</td>');
      return;
    }
    res.type('html').send(statementDetail(raw));
  });

  // --- Forwarding ---
  router.get('/admin/forwarding', async (req: Request, res: Response) => {
    const [targets, tenants] = await Promise.all([
      listForwardTargets(pool),
      listTenantOptions(pool),
    ]);
    const html = render(req, forwardingPage(targets, tenants), layout);
    res.type('html').send(html);
  });

  router.post('/admin/forwarding', async (req: Request, res: Response) => {
    const body = req.body as {
      tenantId?: string;
      url?: string;
      authHeader?: string;
      enabled?: string;
    };
    if (!body.tenantId || !body.url) {
      res.status(400).type('html').send('Missing tenantId or url');
      return;
    }
    await upsertForwardTarget(
      pool,
      body.tenantId,
      body.url,
      body.authHeader ?? '',
      body.enabled === 'true',
    );
    await ctx.forwardWorker?.reloadTargets();

    const [targets, tenants] = await Promise.all([
      listForwardTargets(pool),
      listTenantOptions(pool),
    ]);
    const html = render(req, forwardingPage(targets, tenants), layout);
    res.type('html').send(html);
  });

  router.delete('/admin/forwarding/:tenantId', async (req: Request, res: Response) => {
    await deleteForwardTarget(pool, req.params['tenantId'] as string);
    await ctx.forwardWorker?.reloadTargets();

    const [targets, tenants] = await Promise.all([
      listForwardTargets(pool),
      listTenantOptions(pool),
    ]);
    const html = render(req, forwardingPage(targets, tenants), layout);
    res.type('html').send(html);
  });

  return router;
}
