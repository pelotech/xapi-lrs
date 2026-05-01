/**
 * xAPI Agent Profile Repository — lrsql agent_profile_document table.
 */

import type { PoolClient, QueryConfig } from 'pg';

type Query = Omit<QueryConfig, 'values'>;

const UPSERT_AGENT_PROFILE = {
  name: 'upsert_agent_profile',
  text: `INSERT INTO agent_profile_document (id, profile_id, agent_ifi, last_modified, content_type, content_length, contents)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id, agent_ifi)
     DO UPDATE SET last_modified = $3, content_type = $4, content_length = $5, contents = $6`,
} as const satisfies Query;

const SELECT_AGENT_PROFILE = {
  name: 'select_agent_profile',
  text: `SELECT contents, content_type, content_length, last_modified FROM agent_profile_document
     WHERE profile_id = $1 AND agent_ifi = $2`,
} as const satisfies Query;

const SELECT_AGENT_PROFILE_IDS = {
  name: 'select_agent_profile_ids',
  text: `SELECT profile_id FROM agent_profile_document
     WHERE agent_ifi = $1
       AND ($2::timestamptz IS NULL OR last_modified > $2)`,
} as const satisfies Query;

const DELETE_AGENT_PROFILE = {
  name: 'delete_agent_profile',
  text: `DELETE FROM agent_profile_document
     WHERE profile_id = $1 AND agent_ifi = $2`,
} as const satisfies Query;

// ============================================================================
// Types
// ============================================================================

export interface AgentProfileRow {
  contents: Buffer;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

// ============================================================================
// Functions
// ============================================================================

export async function upsertAgentProfile(
  client: PoolClient,
  params: {
    profileId: string;
    agentIfi: string;
    contents: Buffer;
    contentType: string;
    lastModified: string;
  },
): Promise<void> {
  await client.query({
    ...UPSERT_AGENT_PROFILE,
    values: [
      params.profileId,
      params.agentIfi,
      params.lastModified,
      params.contentType,
      params.contents.length,
      params.contents,
    ],
  });
}

export async function getAgentProfile(
  client: PoolClient,
  params: { profileId: string; agentIfi: string },
): Promise<AgentProfileRow | undefined> {
  const result = await client.query({
    ...SELECT_AGENT_PROFILE,
    values: [params.profileId, params.agentIfi],
  });
  return result.rows[0] as AgentProfileRow | undefined;
}

export async function listAgentProfileIds(
  client: PoolClient,
  params: { agentIfi: string; since?: string },
): Promise<string[]> {
  const result = await client.query({
    ...SELECT_AGENT_PROFILE_IDS,
    values: [params.agentIfi, params.since ?? null],
  });
  return result.rows.map((r: { profile_id: string }) => r.profile_id);
}

export async function deleteAgentProfile(
  client: PoolClient,
  params: { profileId: string; agentIfi: string },
): Promise<void> {
  await client.query({
    ...DELETE_AGENT_PROFILE,
    values: [params.profileId, params.agentIfi],
  });
}
