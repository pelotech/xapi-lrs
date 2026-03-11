/**
 * xAPI Activity Profile Repository — lrsql activity_profile_document table.
 */

import type { PoolClient, QueryConfig } from 'pg';

type Query = Omit<QueryConfig, 'values'>;

const UPSERT_ACTIVITY_PROFILE = {
  name: 'upsert_activity_profile',
  text: `INSERT INTO activity_profile_document (id, profile_id, activity_iri, last_modified, content_type, content_length, contents)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (profile_id, activity_iri)
     DO UPDATE SET last_modified = $3, content_type = $4, content_length = $5, contents = $6`,
} as const satisfies Query;

const SELECT_ACTIVITY_PROFILE = {
  name: 'select_activity_profile',
  text: `SELECT contents, content_type, content_length, last_modified FROM activity_profile_document
     WHERE profile_id = $1 AND activity_iri = $2`,
} as const satisfies Query;

const SELECT_ACTIVITY_PROFILE_IDS = {
  name: 'select_activity_profile_ids',
  text: `SELECT profile_id FROM activity_profile_document
     WHERE activity_iri = $1
       AND ($2::timestamptz IS NULL OR last_modified > $2)`,
} as const satisfies Query;

const DELETE_ACTIVITY_PROFILE = {
  name: 'delete_activity_profile',
  text: `DELETE FROM activity_profile_document
     WHERE profile_id = $1 AND activity_iri = $2`,
} as const satisfies Query;

// ============================================================================
// Types
// ============================================================================

export interface ActivityProfileRow {
  contents: Buffer;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

// ============================================================================
// Functions
// ============================================================================

export async function upsertActivityProfile(
  client: PoolClient,
  params: {
    profileId: string;
    activityIri: string;
    contents: Buffer;
    contentType: string;
    lastModified: string;
  },
): Promise<void> {
  await client.query({
    ...UPSERT_ACTIVITY_PROFILE,
    values: [params.profileId, params.activityIri, params.lastModified, params.contentType, params.contents.length, params.contents],
  });
}

export async function getActivityProfile(
  client: PoolClient,
  params: { profileId: string; activityIri: string },
): Promise<ActivityProfileRow | undefined> {
  const result = await client.query({
    ...SELECT_ACTIVITY_PROFILE,
    values: [params.profileId, params.activityIri],
  });
  return result.rows[0] as ActivityProfileRow | undefined;
}

export async function listActivityProfileIds(
  client: PoolClient,
  params: { activityIri: string; since?: string },
): Promise<string[]> {
  const result = await client.query({
    ...SELECT_ACTIVITY_PROFILE_IDS,
    values: [params.activityIri, params.since ?? null],
  });
  return result.rows.map((r: { profile_id: string }) => r.profile_id);
}

export async function deleteActivityProfile(
  client: PoolClient,
  params: { profileId: string; activityIri: string },
): Promise<void> {
  await client.query({
    ...DELETE_ACTIVITY_PROFILE,
    values: [params.profileId, params.activityIri],
  });
}
