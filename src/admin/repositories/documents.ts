/**
 * Admin document management queries (state, activity-profile, agent-profile).
 */

import type { Pool, QueryConfig } from 'pg';
import type { LrsMetrics } from '../../metrics.ts';
import { poolQuery } from '../../db.ts';

type Query = Omit<QueryConfig, 'values'>;

// ============================================================================
// SQL constants
// ============================================================================

const LIST_STATE_DOCUMENTS = {
  name: 'admin_list_state_docs',
  text: `SELECT id, state_id, activity_iri, agent_ifi, registration,
                content_type, content_length, last_modified
         FROM state_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_STATE_DOCUMENTS = {
  name: 'admin_count_state_docs',
  text: 'SELECT COUNT(*)::int AS count FROM state_document',
} as const satisfies Query;

const LIST_ACTIVITY_PROFILES = {
  name: 'admin_list_activity_profiles',
  text: `SELECT id, profile_id, activity_iri, content_type, content_length, last_modified
         FROM activity_profile_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_ACTIVITY_PROFILES = {
  name: 'admin_count_activity_profiles',
  text: 'SELECT COUNT(*)::int AS count FROM activity_profile_document',
} as const satisfies Query;

const LIST_AGENT_PROFILES = {
  name: 'admin_list_agent_profiles',
  text: `SELECT id, profile_id, agent_ifi, content_type, content_length, last_modified
         FROM agent_profile_document ORDER BY last_modified DESC LIMIT $1 OFFSET $2`,
} as const satisfies Query;

const COUNT_AGENT_PROFILES = {
  name: 'admin_count_agent_profiles',
  text: 'SELECT COUNT(*)::int AS count FROM agent_profile_document',
} as const satisfies Query;

const GET_STATE_DOCUMENT_BY_ID = {
  name: 'admin_get_state_doc',
  text: 'SELECT state_id, activity_iri, agent_ifi, registration, content_type, content_length, contents, last_modified FROM state_document WHERE id = $1',
} as const satisfies Query;

const GET_ACTIVITY_PROFILE_BY_ID = {
  name: 'admin_get_activity_profile',
  text: 'SELECT profile_id, activity_iri, content_type, content_length, contents, last_modified FROM activity_profile_document WHERE id = $1',
} as const satisfies Query;

const GET_AGENT_PROFILE_BY_ID = {
  name: 'admin_get_agent_profile',
  text: 'SELECT profile_id, agent_ifi, content_type, content_length, contents, last_modified FROM agent_profile_document WHERE id = $1',
} as const satisfies Query;

const DELETE_STATE_DOCUMENT_BY_ID = {
  name: 'admin_delete_state_doc',
  text: 'DELETE FROM state_document WHERE id = $1',
} as const satisfies Query;

const DELETE_ACTIVITY_PROFILE_BY_ID = {
  name: 'admin_delete_activity_profile',
  text: 'DELETE FROM activity_profile_document WHERE id = $1',
} as const satisfies Query;

const DELETE_AGENT_PROFILE_BY_ID = {
  name: 'admin_delete_agent_profile',
  text: 'DELETE FROM agent_profile_document WHERE id = $1',
} as const satisfies Query;

const BULK_DELETE_STATE_DOCUMENTS = {
  name: 'admin_bulk_delete_state_docs',
  text: 'DELETE FROM state_document WHERE activity_iri = $1 AND agent_ifi = $2',
} as const satisfies Query;

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// List functions
// ============================================================================

export async function listStateDocuments(pool: Pool, metrics: LrsMetrics, limit: number, offset: number) {
  const [rows, count] = await Promise.all([
    poolQuery<StateDocumentListRow>(pool, metrics, {
      ...LIST_STATE_DOCUMENTS,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_STATE_DOCUMENTS),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

export async function listActivityProfiles(pool: Pool, metrics: LrsMetrics, limit: number, offset: number) {
  const [rows, count] = await Promise.all([
    poolQuery<ActivityProfileListRow>(pool, metrics, {
      ...LIST_ACTIVITY_PROFILES,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_ACTIVITY_PROFILES),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

export async function listAgentProfiles(pool: Pool, metrics: LrsMetrics, limit: number, offset: number) {
  const [rows, count] = await Promise.all([
    poolQuery<AgentProfileListRow>(pool, metrics, {
      ...LIST_AGENT_PROFILES,
      values: [limit, offset],
    }),
    poolQuery<{ count: number }>(pool, metrics, COUNT_AGENT_PROFILES),
  ]);
  return { rows: rows.rows, total: count.rows[0]?.count ?? 0 };
}

// ============================================================================
// Get by ID
// ============================================================================

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

export async function getAgentProfileById(pool: Pool, metrics: LrsMetrics, id: string): Promise<DocumentDetail | null> {
  const result = await poolQuery<DocumentDetail>(pool, metrics, {
    ...GET_AGENT_PROFILE_BY_ID,
    values: [id],
  });
  return result.rows[0] ?? null;
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteStateDocumentById(pool: Pool, metrics: LrsMetrics, id: string): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_STATE_DOCUMENT_BY_ID, values: [id] });
}

export async function deleteActivityProfileById(pool: Pool, metrics: LrsMetrics, id: string): Promise<void> {
  await poolQuery(pool, metrics, { ...DELETE_ACTIVITY_PROFILE_BY_ID, values: [id] });
}

export async function deleteAgentProfileById(pool: Pool, metrics: LrsMetrics, id: string): Promise<void> {
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
