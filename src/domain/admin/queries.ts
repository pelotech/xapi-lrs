import type pg from 'pg';
import type { DashboardStats } from './views/dashboard.js';
import type { TenantRow } from './views/tenants-list.js';
import type { TokenRow } from './views/tokens-list.js';
import type { StatementRow, TenantOption } from './views/statements-list.js';

export async function getDashboardStats(pool: pg.Pool): Promise<DashboardStats> {
  const [tenants, tokens, statements, documents] = await Promise.all([
    pool.query('SELECT count(*)::int AS c FROM tenant.tenants'),
    pool.query('SELECT count(*)::int AS c FROM xapi.tokens'),
    pool.query('SELECT count(*)::int AS c FROM xapi.statements'),
    pool.query('SELECT count(*)::int AS c FROM xapi.documents'),
  ]);
  return {
    tenantCount: tenants.rows[0].c,
    tokenCount: tokens.rows[0].c,
    statementCount: statements.rows[0].c,
    documentCount: documents.rows[0].c,
  };
}

export async function listTenants(pool: pg.Pool): Promise<TenantRow[]> {
  const { rows } = await pool.query(`
    SELECT
      t.id, t.name, t.slug, t.is_active, t.created_at,
      (SELECT count(*)::int FROM xapi.tokens tk WHERE tk.tenant_id = t.id) AS token_count,
      (SELECT count(*)::int FROM xapi.statements s WHERE s.tenant_id = t.id) AS statement_count
    FROM tenant.tenants t
    ORDER BY t.created_at DESC
  `);
  return rows;
}

export async function listTenantOptions(pool: pg.Pool): Promise<TenantOption[]> {
  const { rows } = await pool.query(
    'SELECT id, name FROM tenant.tenants ORDER BY name',
  );
  return rows;
}

export interface ListTokensParams {
  search?: string;
  limit: number;
  offset: number;
}

export async function listTokens(
  pool: pg.Pool,
  params: ListTokensParams,
): Promise<TokenRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.search) {
    conditions.push(
      `(tk.user_sub ILIKE $${idx} OR t.name ILIKE $${idx})`,
    );
    values.push(`%${params.search}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT tk.id, tk.tenant_id, t.name AS tenant_name, tk.user_sub, tk.scopes, tk.created_at
     FROM xapi.tokens tk
     JOIN tenant.tenants t ON t.id = tk.tenant_id
     ${where}
     ORDER BY tk.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, params.limit, params.offset],
  );
  return rows;
}

export interface ListStatementsParams {
  tenantId?: string;
  verbId?: string;
  actorIfi?: string;
  activityId?: string;
  since?: string;
  limit: number;
  offset: number;
}

export interface ListStatementsResult {
  rows: StatementRow[];
  total: number;
}

export async function listStatements(
  pool: pg.Pool,
  params: ListStatementsParams,
): Promise<ListStatementsResult> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.tenantId) {
    conditions.push(`s.tenant_id = $${idx}::uuid`);
    values.push(params.tenantId);
    idx++;
  }
  if (params.verbId) {
    conditions.push(`s.verb_id = $${idx}`);
    values.push(params.verbId);
    idx++;
  }
  if (params.actorIfi) {
    conditions.push(`s.actor_ifi = $${idx}`);
    values.push(params.actorIfi);
    idx++;
  }
  if (params.activityId) {
    conditions.push(`s.activity_id = $${idx}`);
    values.push(params.activityId);
    idx++;
  }
  if (params.since) {
    conditions.push(`s.stored >= $${idx}::timestamptz`);
    values.push(params.since);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT count(*)::int AS c FROM xapi.statements s ${where}`,
    values,
  );

  const { rows } = await pool.query(
    `SELECT s.id, s.tenant_id, t.name AS tenant_name, s.verb_id, s.actor_ifi,
            s.activity_id, s."timestamp", s.stored
     FROM xapi.statements s
     JOIN tenant.tenants t ON t.id = s.tenant_id
     ${where}
     ORDER BY s.stored DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, params.limit, params.offset],
  );

  return { rows, total: countResult.rows[0].c };
}

export async function getStatementRaw(
  pool: pg.Pool,
  id: string,
): Promise<unknown | null> {
  const { rows } = await pool.query(
    'SELECT raw FROM xapi.statements WHERE id = $1::uuid LIMIT 1',
    [id],
  );
  return rows[0]?.raw ?? null;
}
