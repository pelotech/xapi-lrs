/**
 * Admin dashboard queries.
 */

import type { Pool, QueryConfig } from "pg";
import type { LrsMetrics } from "../../metrics.ts";
import { poolQuery } from "../../db.ts";

type Query = Omit<QueryConfig, "values">;

const COUNT_STATEMENTS = {
  name: "admin_count_statements",
  text: "SELECT COUNT(*)::int AS count FROM xapi_statement",
} as const satisfies Query;

const COUNT_STATEMENTS_24H = {
  name: "admin_count_statements_24h",
  text: "SELECT COUNT(*)::int AS count FROM xapi_statement WHERE stored > NOW() - INTERVAL '24 hours'",
} as const satisfies Query;

const COUNT_STATEMENTS_7D = {
  name: "admin_count_statements_7d",
  text: "SELECT COUNT(*)::int AS count FROM xapi_statement WHERE stored > NOW() - INTERVAL '7 days'",
} as const satisfies Query;

const COUNT_CREDENTIALS = {
  name: "admin_count_credentials",
  text: "SELECT COUNT(*)::int AS count FROM lrs_credential",
} as const satisfies Query;

const COUNT_ACCOUNTS = {
  name: "admin_count_accounts",
  text: "SELECT COUNT(*)::int AS count FROM admin_account",
} as const satisfies Query;

const RECENT_STATEMENTS = {
  name: "admin_recent_statements",
  text: `SELECT statement_id, verb_iri, payload->'actor' AS actor,
                payload->'object' AS object, stored
         FROM xapi_statement ORDER BY stored DESC LIMIT 10`,
} as const satisfies Query;

export interface DashboardCounts {
  totalStatements: number;
  statements24h: number;
  statements7d: number;
  credentialCount: number;
  accountCount: number;
}

export interface RecentStatement {
  statement_id: string;
  verb_iri: string;
  actor: Record<string, unknown>;
  object: Record<string, unknown>;
  stored: Date;
}

export async function getDashboardCounts(
  pool: Pool,
  metrics: LrsMetrics,
): Promise<DashboardCounts> {
  const [total, h24, d7, creds, accts] = await Promise.all([
    poolQuery<{ count: number }>(pool, metrics, COUNT_STATEMENTS),
    poolQuery<{ count: number }>(pool, metrics, COUNT_STATEMENTS_24H),
    poolQuery<{ count: number }>(pool, metrics, COUNT_STATEMENTS_7D),
    poolQuery<{ count: number }>(pool, metrics, COUNT_CREDENTIALS),
    poolQuery<{ count: number }>(pool, metrics, COUNT_ACCOUNTS),
  ]);

  return {
    totalStatements: total.rows[0]?.count ?? 0,
    statements24h: h24.rows[0]?.count ?? 0,
    statements7d: d7.rows[0]?.count ?? 0,
    credentialCount: creds.rows[0]?.count ?? 0,
    accountCount: accts.rows[0]?.count ?? 0,
  };
}

export async function getRecentStatements(
  pool: Pool,
  metrics: LrsMetrics,
): Promise<RecentStatement[]> {
  const result = await poolQuery<RecentStatement>(pool, metrics, RECENT_STATEMENTS);
  return result.rows;
}
