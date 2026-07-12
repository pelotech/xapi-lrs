/**
 * Admin credential management queries.
 *
 * Scope rows key by the composite (api_key, secret_key) pair, per lrsql's
 * `credential_fk` — `lrs_credential.id` remains the admin-API handle but is
 * not part of that foreign key.
 */

import type { QueryConfig } from 'pg';
import type { DbClient, DbPool } from '../../db.ts';
import { poolQuery, withClient } from '../../db.ts';
import type { LrsMetrics } from '../../metrics.ts';

type Query = Omit<QueryConfig, 'values'>;

const LIST_CREDENTIALS = {
  name: 'admin_list_credentials',
  text: `SELECT c.id, c.api_key, c.label, a.username AS account_name, a.id AS account_id,
                COALESCE(json_agg(s.scope::text ORDER BY s.scope::text) FILTER (WHERE s.scope IS NOT NULL), '[]') AS scopes
         FROM lrs_credential c
         JOIN admin_account a ON a.id = c.account_id
         LEFT JOIN credential_to_scope s ON s.api_key = c.api_key AND s.secret_key = c.secret_key
         GROUP BY c.id, c.api_key, c.label, a.username, a.id
         ORDER BY c.api_key`,
} as const satisfies Query;

const LIST_CREDENTIALS_BY_API_KEY = {
  name: 'admin_list_credentials_by_api_key',
  text: `SELECT c.id, c.api_key, c.label, a.username AS account_name, a.id AS account_id,
                COALESCE(json_agg(s.scope::text ORDER BY s.scope::text) FILTER (WHERE s.scope IS NOT NULL), '[]') AS scopes
         FROM lrs_credential c
         JOIN admin_account a ON a.id = c.account_id
         LEFT JOIN credential_to_scope s ON s.api_key = c.api_key AND s.secret_key = c.secret_key
         WHERE c.api_key = $1
         GROUP BY c.id, c.api_key, c.label, a.username, a.id
         ORDER BY c.api_key`,
} as const satisfies Query;

const GET_CREDENTIAL = {
  name: 'admin_get_credential',
  text: `SELECT c.id, c.api_key, c.label, a.username AS account_name, a.id AS account_id,
                COALESCE(json_agg(s.scope::text ORDER BY s.scope::text) FILTER (WHERE s.scope IS NOT NULL), '[]') AS scopes
         FROM lrs_credential c
         JOIN admin_account a ON a.id = c.account_id
         LEFT JOIN credential_to_scope s ON s.api_key = c.api_key AND s.secret_key = c.secret_key
         WHERE c.id = $1
         GROUP BY c.id, c.api_key, c.label, a.username, a.id`,
} as const satisfies Query;

const CREATE_CREDENTIAL = {
  name: 'admin_create_credential',
  text: 'INSERT INTO lrs_credential (id, api_key, secret_key, account_id, label) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id',
} as const satisfies Query;

const DELETE_CREDENTIAL = {
  name: 'admin_delete_credential',
  text: 'DELETE FROM lrs_credential WHERE id = $1',
} as const satisfies Query;

const GET_CREDENTIAL_KEYS_FOR_UPDATE = {
  name: 'admin_get_credential_keys_for_update',
  text: 'SELECT api_key, secret_key FROM lrs_credential WHERE id = $1 FOR UPDATE',
} as const satisfies Query;

const GET_CREDENTIAL_SCOPES_BY_KEYS = {
  name: 'admin_get_credential_scopes_by_keys',
  text: 'SELECT scope FROM credential_to_scope WHERE api_key = $1 AND secret_key = $2',
} as const satisfies Query;

const UPDATE_SECRET_KEY = {
  name: 'admin_update_secret_key',
  text: 'UPDATE lrs_credential SET secret_key = $1 WHERE id = $2',
} as const satisfies Query;

const DELETE_CREDENTIAL_SCOPES = {
  name: 'admin_delete_credential_scopes',
  text: 'DELETE FROM credential_to_scope WHERE api_key = $1 AND secret_key = $2',
} as const satisfies Query;

const INSERT_CREDENTIAL_SCOPE = {
  name: 'admin_insert_credential_scope',
  text: 'INSERT INTO credential_to_scope (id, api_key, secret_key, scope) VALUES (gen_random_uuid(), $1, $2, $3::scope_enum)',
} as const satisfies Query;

export interface CredentialRow {
  id: string;
  api_key: string;
  label: string | null;
  account_name: string;
  account_id: string;
  scopes: string[];
}

export async function listCredentials(
  pool: DbPool,
  metrics: LrsMetrics,
  filter: { apiKey?: string } = {},
): Promise<CredentialRow[]> {
  if (filter.apiKey !== undefined) {
    const result = await poolQuery<CredentialRow>(pool, metrics, {
      ...LIST_CREDENTIALS_BY_API_KEY,
      values: [filter.apiKey],
    });
    return result.rows;
  }
  const result = await poolQuery<CredentialRow>(pool, metrics, LIST_CREDENTIALS);
  return result.rows;
}

export async function getCredentialById(
  pool: DbPool,
  metrics: LrsMetrics,
  credentialId: string,
): Promise<CredentialRow | null> {
  const result = await poolQuery<CredentialRow>(pool, metrics, {
    ...GET_CREDENTIAL,
    values: [credentialId],
  });
  return result.rows[0] ?? null;
}

export async function createCredential(
  pool: DbPool,
  metrics: LrsMetrics,
  apiKey: string,
  secretKey: string,
  accountId: string,
  label: string | null = null,
): Promise<string> {
  const result = await poolQuery<{ id: string }>(pool, metrics, {
    ...CREATE_CREDENTIAL,
    values: [apiKey, secretKey, accountId, label],
  });
  return result.rows[0].id;
}

export async function deleteCredential(pool: DbPool, metrics: LrsMetrics, credentialId: string): Promise<boolean> {
  const result = await poolQuery(pool, metrics, { ...DELETE_CREDENTIAL, values: [credentialId] });
  return (result.rowCount ?? 0) > 0;
}

/**
 * Rotate a credential's secret key.
 *
 * `credential_to_scope` rows are FK'd on (api_key, secret_key) with
 * ON DELETE CASCADE but no ON UPDATE action, so updating `secret_key`
 * in place while scope rows reference the old pair violates `credential_fk`.
 * Do this transactionally: lock the credential row, snapshot its scopes,
 * drop them, rotate the secret, then re-insert the scopes under the new pair.
 */
export async function rotateSecret(
  pool: DbPool,
  metrics: LrsMetrics,
  credentialId: string,
  newSecret: string,
): Promise<boolean> {
  return withClient(pool, metrics, async (client: DbClient) => {
    const keysResult = await client.query<{ api_key: string; secret_key: string }>({
      ...GET_CREDENTIAL_KEYS_FOR_UPDATE,
      values: [credentialId],
    });
    const keys = keysResult.rows[0];
    if (!keys) return false;

    const scopesResult = await client.query<{ scope: string | null }>({
      ...GET_CREDENTIAL_SCOPES_BY_KEYS,
      values: [keys.api_key, keys.secret_key],
    });

    await client.query({ ...DELETE_CREDENTIAL_SCOPES, values: [keys.api_key, keys.secret_key] });
    await client.query({ ...UPDATE_SECRET_KEY, values: [newSecret, credentialId] });

    for (const row of scopesResult.rows) {
      if (row.scope === null) continue;
      await client.query({ ...INSERT_CREDENTIAL_SCOPE, values: [keys.api_key, newSecret, row.scope] });
    }

    return true;
  });
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

/**
 * Replace a credential's scopes.
 *
 * Runs inside a transaction with the lrs_credential row locked FOR UPDATE:
 * a concurrent rotateSecret would otherwise change (api_key, secret_key)
 * after we read it, making every scope insert violate `credential_fk`.
 */
export async function setCredentialScopes(
  pool: DbPool,
  metrics: LrsMetrics,
  credentialId: string,
  scopes: string[],
): Promise<boolean> {
  return withClient(pool, metrics, async (client: DbClient) => {
    const keysResult = await client.query<{ api_key: string; secret_key: string }>({
      ...GET_CREDENTIAL_KEYS_FOR_UPDATE,
      values: [credentialId],
    });
    const keys = keysResult.rows[0];
    if (!keys) return false;

    await client.query({ ...DELETE_CREDENTIAL_SCOPES, values: [keys.api_key, keys.secret_key] });
    for (const scope of scopes) {
      await client.query({ ...INSERT_CREDENTIAL_SCOPE, values: [keys.api_key, keys.secret_key, scope] });
    }
    return true;
  });
}
