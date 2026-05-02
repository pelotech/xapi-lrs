/**
 * Admin credential management queries.
 */

import type { QueryConfig } from 'pg';
import type { DbPool } from '../../db.ts';
import type { LrsMetrics } from '../../metrics.ts';
import { poolQuery } from '../../db.ts';

type Query = Omit<QueryConfig, 'values'>;

const LIST_CREDENTIALS = {
  name: 'admin_list_credentials',
  text: `SELECT c.id, c.api_key, a.username AS account_name, a.id AS account_id,
                COALESCE(array_agg(s.scope) FILTER (WHERE s.scope IS NOT NULL), '{}') AS scopes
         FROM lrs_credential c
         JOIN admin_account a ON a.id = c.account_id
         LEFT JOIN credential_to_scope s ON s.credential_id = c.id
         GROUP BY c.id, c.api_key, a.username, a.id
         ORDER BY c.api_key`,
} as const satisfies Query;

const CREATE_CREDENTIAL = {
  name: 'admin_create_credential',
  text: 'INSERT INTO lrs_credential (id, api_key, secret_key, account_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
} as const satisfies Query;

const DELETE_CREDENTIAL = {
  name: 'admin_delete_credential',
  text: 'DELETE FROM lrs_credential WHERE id = $1',
} as const satisfies Query;

const ROTATE_SECRET = {
  name: 'admin_rotate_secret',
  text: 'UPDATE lrs_credential SET secret_key = $1 WHERE id = $2',
} as const satisfies Query;

const DELETE_CREDENTIAL_SCOPES = {
  name: 'admin_delete_credential_scopes',
  text: 'DELETE FROM credential_to_scope WHERE credential_id = $1',
} as const satisfies Query;

const INSERT_CREDENTIAL_SCOPE = {
  name: 'admin_insert_credential_scope',
  text: 'INSERT INTO credential_to_scope (id, credential_id, scope) VALUES (gen_random_uuid(), $1, $2::scope_enum) ON CONFLICT DO NOTHING',
} as const satisfies Query;

export interface CredentialRow {
  id: string;
  api_key: string;
  account_name: string;
  account_id: string;
  scopes: string[];
}

export async function listCredentials(pool: DbPool, metrics: LrsMetrics): Promise<CredentialRow[]> {
  const result = await poolQuery<CredentialRow>(pool, metrics, LIST_CREDENTIALS);
  return result.rows;
}

export async function createCredential(
  pool: DbPool,
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

export async function deleteCredential(pool: DbPool, metrics: LrsMetrics, credentialId: string): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_CREDENTIAL, values: [credentialId] });
}

export async function rotateSecret(
  pool: DbPool,
  metrics: LrsMetrics,
  credentialId: string,
  newSecret: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...ROTATE_SECRET, values: [newSecret, credentialId] });
}

export async function ensureDefaultCredential(
  pool: DbPool,
  metrics: LrsMetrics,
  apiKey: string,
  secretKey: string,
  accountId: string,
): Promise<void> {
  const existing = await poolQuery<{ id: string }>(pool, metrics, {
    name: 'admin_get_credential_by_key',
    text: 'SELECT id FROM lrs_credential WHERE api_key = $1',
    values: [apiKey],
  });
  if (existing.rows.length === 0) {
    const credId = await createCredential(pool, metrics, apiKey, secretKey, accountId);
    await setCredentialScopes(pool, metrics, credId, ['all']);
  }
}

export async function setCredentialScopes(
  pool: DbPool,
  metrics: LrsMetrics,
  credentialId: string,
  scopes: string[],
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_CREDENTIAL_SCOPES, values: [credentialId] });
  for (const scope of scopes) {
    await poolQuery(pool, metrics, { ...INSERT_CREDENTIAL_SCOPE, values: [credentialId, scope] });
  }
}
