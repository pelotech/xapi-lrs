/**
 * Admin credential management queries.
 */

import type { Pool, QueryConfig } from "pg";
import type { LrsMetrics } from "../../metrics.ts";
import { poolQuery } from "../../db.ts";

type Query = Omit<QueryConfig, "values">;

const LIST_CREDENTIALS = {
  name: "admin_list_credentials",
  text: `SELECT c.id, c.api_key, a.username AS account_name, a.id AS account_id,
                COALESCE(array_agg(s.scope) FILTER (WHERE s.scope IS NOT NULL), '{}') AS scopes
         FROM lrs_credential c
         JOIN admin_account a ON a.id = c.account_id
         LEFT JOIN credential_to_scope s ON s.credential_id = c.id
         GROUP BY c.id, c.api_key, a.username, a.id
         ORDER BY c.api_key`,
} as const satisfies Query;

const CREATE_CREDENTIAL = {
  name: "admin_create_credential",
  text: "INSERT INTO lrs_credential (id, api_key, secret_key, account_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id",
} as const satisfies Query;

const DELETE_CREDENTIAL = {
  name: "admin_delete_credential",
  text: "DELETE FROM lrs_credential WHERE id = $1",
} as const satisfies Query;

const ROTATE_SECRET = {
  name: "admin_rotate_secret",
  text: "UPDATE lrs_credential SET secret_key = $1 WHERE id = $2",
} as const satisfies Query;

const DELETE_CREDENTIAL_SCOPES = {
  name: "admin_delete_credential_scopes",
  text: "DELETE FROM credential_to_scope WHERE credential_id = $1",
} as const satisfies Query;

const INSERT_CREDENTIAL_SCOPE = {
  name: "admin_insert_credential_scope",
  text: "INSERT INTO credential_to_scope (id, credential_id, scope) VALUES (gen_random_uuid(), $1, $2::scope_enum) ON CONFLICT DO NOTHING",
} as const satisfies Query;

export interface CredentialRow {
  id: string;
  api_key: string;
  account_name: string;
  account_id: string;
  scopes: string[];
}

export async function listCredentials(pool: Pool, metrics: LrsMetrics): Promise<CredentialRow[]> {
  const result = await poolQuery<CredentialRow>(pool, metrics, LIST_CREDENTIALS);
  return result.rows;
}

export async function createCredential(
  pool: Pool,
  metrics: LrsMetrics,
  apiKey: string,
  secretKey: string,
  accountId: string,
): Promise<string> {
  const result = await poolQuery<{ id: string }>(pool, metrics, {
    ...CREATE_CREDENTIAL,
    values: [apiKey, secretKey, accountId],
  });
  return result.rows[0].id;
}

export async function deleteCredential(
  pool: Pool,
  metrics: LrsMetrics,
  credentialId: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_CREDENTIAL, values: [credentialId] });
}

export async function rotateSecret(
  pool: Pool,
  metrics: LrsMetrics,
  credentialId: string,
  newSecret: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...ROTATE_SECRET, values: [newSecret, credentialId] });
}

export async function setCredentialScopes(
  pool: Pool,
  metrics: LrsMetrics,
  credentialId: string,
  scopes: string[],
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_CREDENTIAL_SCOPES, values: [credentialId] });
  for (const scope of scopes) {
    await poolQuery(pool, metrics, { ...INSERT_CREDENTIAL_SCOPE, values: [credentialId, scope] });
  }
}
