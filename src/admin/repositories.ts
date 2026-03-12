/**
 * Admin-specific database queries.
 * Uses pgcrypto crypt()/gen_salt() for bcrypt password hashing in the DB.
 */

import type { Pool, QueryConfig } from "pg";
import type { LrsMetrics } from "../metrics.ts";
import { poolQuery } from "../db.ts";

type Query = Omit<QueryConfig, "values">;

// ============================================================================
// Dashboard
// ============================================================================

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

// ============================================================================
// Accounts
// ============================================================================

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

// ============================================================================
// Credentials
// ============================================================================

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

// ============================================================================
// Documents (listing for admin browser)
// ============================================================================

const LIST_STATE_DOCUMENTS = {
  name: "admin_list_state_docs",
  text: `SELECT id, state_id, activity_iri, agent_ifi, registration,
                content_type, content_length, last_modified
         FROM state_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_STATE_DOCUMENTS = {
  name: "admin_count_state_docs",
  text: "SELECT COUNT(*)::int AS count FROM state_document",
} as const satisfies Query;

const LIST_ACTIVITY_PROFILES = {
  name: "admin_list_activity_profiles",
  text: `SELECT id, profile_id, activity_iri, content_type, content_length, last_modified
         FROM activity_profile_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_ACTIVITY_PROFILES = {
  name: "admin_count_activity_profiles",
  text: "SELECT COUNT(*)::int AS count FROM activity_profile_document",
} as const satisfies Query;

const LIST_AGENT_PROFILES = {
  name: "admin_list_agent_profiles",
  text: `SELECT id, profile_id, agent_ifi, content_type, content_length, last_modified
         FROM agent_profile_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_AGENT_PROFILES = {
  name: "admin_count_agent_profiles",
  text: "SELECT COUNT(*)::int AS count FROM agent_profile_document",
} as const satisfies Query;

const GET_STATE_DOCUMENT_BY_ID = {
  name: "admin_get_state_doc",
  text: "SELECT state_id, activity_iri, agent_ifi, registration, content_type, content_length, contents, last_modified FROM state_document WHERE id = $1",
} as const satisfies Query;

const GET_ACTIVITY_PROFILE_BY_ID = {
  name: "admin_get_activity_profile",
  text: "SELECT profile_id, activity_iri, content_type, content_length, contents, last_modified FROM activity_profile_document WHERE id = $1",
} as const satisfies Query;

const GET_AGENT_PROFILE_BY_ID = {
  name: "admin_get_agent_profile",
  text: "SELECT profile_id, agent_ifi, content_type, content_length, contents, last_modified FROM agent_profile_document WHERE id = $1",
} as const satisfies Query;

const DELETE_STATE_DOCUMENT_BY_ID = {
  name: "admin_delete_state_doc",
  text: "DELETE FROM state_document WHERE id = $1",
} as const satisfies Query;

const DELETE_ACTIVITY_PROFILE_BY_ID = {
  name: "admin_delete_activity_profile",
  text: "DELETE FROM activity_profile_document WHERE id = $1",
} as const satisfies Query;

const DELETE_AGENT_PROFILE_BY_ID = {
  name: "admin_delete_agent_profile",
  text: "DELETE FROM agent_profile_document WHERE id = $1",
} as const satisfies Query;

const BULK_DELETE_STATE_DOCUMENTS = {
  name: "admin_bulk_delete_state_docs",
  text: "DELETE FROM state_document WHERE activity_iri = $1 AND agent_ifi = $2",
} as const satisfies Query;

export interface StateDocumentListRow {
  id: string;
  state_id: string;
  activity_iri: string;
  agent_ifi: string;
  registration: string | null;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

export interface ActivityProfileListRow {
  id: string;
  profile_id: string;
  activity_iri: string;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

export interface AgentProfileListRow {
  id: string;
  profile_id: string;
  agent_ifi: string;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

export interface DocumentDetail {
  content_type: string;
  content_length: number;
  contents: Buffer;
  last_modified: Date;
  [key: string]: unknown;
}

export async function listStateDocuments(
  pool: Pool,
  metrics: LrsMetrics,
  limit: number,
  offset: number,
) {
  const [rows, count] = await Promise.all([
    poolQuery<StateDocumentListRow>(pool, metrics, {
      ...LIST_STATE_DOCUMENTS,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_STATE_DOCUMENTS),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

export async function listActivityProfiles(
  pool: Pool,
  metrics: LrsMetrics,
  limit: number,
  offset: number,
) {
  const [rows, count] = await Promise.all([
    poolQuery<ActivityProfileListRow>(pool, metrics, {
      ...LIST_ACTIVITY_PROFILES,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_ACTIVITY_PROFILES),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

export async function listAgentProfiles(
  pool: Pool,
  metrics: LrsMetrics,
  limit: number,
  offset: number,
) {
  const [rows, count] = await Promise.all([
    poolQuery<AgentProfileListRow>(pool, metrics, {
      ...LIST_AGENT_PROFILES,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_AGENT_PROFILES),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

export async function getStateDocumentById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<DocumentDetail | null> {
  const result = await poolQuery<DocumentDetail>(pool, metrics, {
    ...GET_STATE_DOCUMENT_BY_ID,
    values: [id],
  });
  return result.rows[0] ?? null;
}

export async function getActivityProfileById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<DocumentDetail | null> {
  const result = await poolQuery<DocumentDetail>(pool, metrics, {
    ...GET_ACTIVITY_PROFILE_BY_ID,
    values: [id],
  });
  return result.rows[0] ?? null;
}

export async function getAgentProfileById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<DocumentDetail | null> {
  const result = await poolQuery<DocumentDetail>(pool, metrics, {
    ...GET_AGENT_PROFILE_BY_ID,
    values: [id],
  });
  return result.rows[0] ?? null;
}

export async function deleteStateDocumentById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_STATE_DOCUMENT_BY_ID, values: [id] });
}

export async function deleteActivityProfileById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_ACTIVITY_PROFILE_BY_ID, values: [id] });
}

export async function deleteAgentProfileById(
  pool: Pool,
  metrics: LrsMetrics,
  id: string,
): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_AGENT_PROFILE_BY_ID, values: [id] });
}

export async function bulkDeleteStateDocuments(
  pool: Pool,
  metrics: LrsMetrics,
  activityIri: string,
  agentIfi: string,
): Promise<number> {
  const result = await poolQuery(pool, metrics, {
    ...BULK_DELETE_STATE_DOCUMENTS,
    values: [activityIri, agentIfi],
  });
  return result.rowCount ?? 0;
}

// ============================================================================
// Statement attachments (for admin detail view)
// ============================================================================

const LIST_ATTACHMENTS = {
  name: "admin_list_attachments",
  text: "SELECT attachment_sha, content_type, content_length FROM attachment WHERE statement_id = $1",
} as const satisfies Query;

const GET_ATTACHMENT = {
  name: "admin_get_attachment",
  text: "SELECT contents, content_type FROM attachment WHERE statement_id = $1 AND attachment_sha = $2",
} as const satisfies Query;

export interface AttachmentListRow {
  attachment_sha: string;
  content_type: string;
  content_length: number;
}

export async function listAttachments(
  pool: Pool,
  metrics: LrsMetrics,
  statementId: string,
): Promise<AttachmentListRow[]> {
  const result = await poolQuery<AttachmentListRow>(pool, metrics, {
    ...LIST_ATTACHMENTS,
    values: [statementId],
  });
  return result.rows;
}

export async function getAttachment(
  pool: Pool,
  metrics: LrsMetrics,
  statementId: string,
  sha: string,
): Promise<{ contents: Buffer; content_type: string } | null> {
  const result = await poolQuery<{ contents: Buffer; content_type: string }>(pool, metrics, {
    ...GET_ATTACHMENT,
    values: [statementId, sha],
  });
  return result.rows[0] ?? null;
}

// ============================================================================
// Bootstrap
// ============================================================================

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
