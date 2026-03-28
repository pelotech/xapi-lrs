/**
 * Admin account management queries.
 */

import type { Pool, QueryConfig } from "pg";
import type { LrsMetrics } from "../../metrics.ts";
import { poolQuery } from "../../db.ts";

type Query = Omit<QueryConfig, "values">;

const LIST_ACCOUNTS = {
  name: "admin_list_accounts",
  text: `SELECT a.id, a.username,
                (SELECT COUNT(*)::int FROM lrs_credential c WHERE c.account_id = a.id) AS credential_count
         FROM admin_account a ORDER BY a.username`,
} as const satisfies Query;

const GET_ACCOUNT_BY_USERNAME = {
  name: "admin_get_account_by_username",
  text: "SELECT id, username FROM admin_account WHERE username = $1",
} as const satisfies Query;

const VERIFY_ACCOUNT_PASSWORD = {
  name: "admin_verify_password",
  text: "SELECT id, username FROM admin_account WHERE username = $1 AND passhash = crypt($2, passhash)",
} as const satisfies Query;

const CREATE_ACCOUNT = {
  name: "admin_create_account",
  text: "INSERT INTO admin_account (id, username, passhash) VALUES (gen_random_uuid(), $1, crypt($2, gen_salt('bf'))) RETURNING id",
} as const satisfies Query;

const DELETE_ACCOUNT = {
  name: "admin_delete_account",
  text: "DELETE FROM admin_account WHERE id = $1",
} as const satisfies Query;

const CHANGE_PASSWORD = {
  name: "admin_change_password",
  text: "UPDATE admin_account SET passhash = crypt($2, gen_salt('bf')) WHERE id = $1",
} as const satisfies Query;

export interface AccountRow {
  id: string;
  username: string;
  credential_count?: number;
}

export async function listAccounts(pool: Pool, metrics: LrsMetrics): Promise<AccountRow[]> {
  const result = await poolQuery<AccountRow>(pool, metrics, LIST_ACCOUNTS);
  return result.rows;
}

export async function verifyPassword(
  pool: Pool,
  metrics: LrsMetrics,
  username: string,
  password: string,
): Promise<AccountRow | null> {
  const result = await poolQuery<AccountRow>(pool, metrics, {
    ...VERIFY_ACCOUNT_PASSWORD,
    values: [username, password],
  });
  return result.rows[0] ?? null;
}

export async function getAccountByUsername(
  pool: Pool,
  metrics: LrsMetrics,
  username: string,
): Promise<AccountRow | null> {
  const result = await poolQuery<AccountRow>(pool, metrics, {
    ...GET_ACCOUNT_BY_USERNAME,
    values: [username],
  });
  return result.rows[0] ?? null;
}

export async function createAccount(
  pool: Pool,
  metrics: LrsMetrics,
  username: string,
  password: string,
): Promise<string> {
  const result = await poolQuery<{ id: string }>(pool, metrics, {
    ...CREATE_ACCOUNT,
    values: [username, password],
  });
  return result.rows[0].id;
}

export async function deleteAccount(
  pool: Pool,
  metrics: LrsMetrics,
  accountId: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_ACCOUNT, values: [accountId] });
}

export async function changePassword(
  pool: Pool,
  metrics: LrsMetrics,
  accountId: string,
  newPassword: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...CHANGE_PASSWORD, values: [accountId, newPassword] });
}

export async function ensureAdminAccount(
  pool: Pool,
  metrics: LrsMetrics,
  username: string,
  password: string,
): Promise<void> {
  const existing = await getAccountByUsername(pool, metrics, username);
  if (!existing) {
    await createAccount(pool, metrics, username, password);
  }
}
