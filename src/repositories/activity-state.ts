/**
 * xAPI Activity State Repository — lrsql state_document table.
 */

import type { PoolClient, QueryConfig } from "pg";

type Query = Omit<QueryConfig, "values">;

const UPSERT_STATE_DOCUMENT = {
  name: "upsert_state_document",
  text: `INSERT INTO state_document (id, state_id, activity_iri, agent_ifi, registration, last_modified, content_type, content_length, contents)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (state_id, activity_iri, agent_ifi, COALESCE(registration::text, ''))
     DO UPDATE SET last_modified = $5, content_type = $6, content_length = $7, contents = $8`,
} as const satisfies Query;

const SELECT_STATE_DOCUMENT = {
  name: "select_state_document",
  text: `SELECT contents, content_type, content_length, last_modified FROM state_document
     WHERE state_id = $1 AND activity_iri = $2 AND agent_ifi = $3
       AND (registration = $4 OR ($4 IS NULL AND registration IS NULL))`,
} as const satisfies Query;

const SELECT_STATE_IDS = {
  name: "select_state_ids",
  text: `SELECT state_id FROM state_document
     WHERE activity_iri = $1 AND agent_ifi = $2
       AND (registration = $3 OR ($3 IS NULL AND registration IS NULL))
       AND ($4::timestamptz IS NULL OR last_modified > $4)`,
} as const satisfies Query;

const DELETE_STATE_DOCUMENT = {
  name: "delete_state_document",
  text: `DELETE FROM state_document
     WHERE state_id = $1 AND activity_iri = $2 AND agent_ifi = $3
       AND (registration = $4 OR ($4 IS NULL AND registration IS NULL))`,
} as const satisfies Query;

const DELETE_STATE_DOCUMENTS = {
  name: "delete_state_documents",
  text: `DELETE FROM state_document
     WHERE activity_iri = $1 AND agent_ifi = $2
       AND (registration = $3 OR ($3 IS NULL AND registration IS NULL))
       AND ($4::timestamptz IS NULL OR last_modified > $4)`,
} as const satisfies Query;

// ============================================================================
// Types
// ============================================================================

export interface StateDocumentRow {
  contents: Buffer;
  content_type: string;
  content_length: number;
  last_modified: Date;
}

// ============================================================================
// Functions
// ============================================================================

export async function upsertStateDocument(
  client: PoolClient,
  params: {
    stateId: string;
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
    contents: Buffer;
    contentType: string;
    lastModified: string;
  },
): Promise<void> {
  await client.query({
    ...UPSERT_STATE_DOCUMENT,
    values: [
      params.stateId,
      params.activityIri,
      params.agentIfi,
      params.registration ?? null,
      params.lastModified,
      params.contentType,
      params.contents.length,
      params.contents,
    ],
  });
}

export async function getStateDocument(
  client: PoolClient,
  params: {
    stateId: string;
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
  },
): Promise<StateDocumentRow | undefined> {
  const result = await client.query({
    ...SELECT_STATE_DOCUMENT,
    values: [params.stateId, params.activityIri, params.agentIfi, params.registration ?? null],
  });
  return result.rows[0] as StateDocumentRow | undefined;
}

export async function listStateIds(
  client: PoolClient,
  params: {
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
    since: string | undefined;
  },
): Promise<string[]> {
  const result = await client.query({
    ...SELECT_STATE_IDS,
    values: [
      params.activityIri,
      params.agentIfi,
      params.registration ?? null,
      params.since ?? null,
    ],
  });
  return result.rows.map((r: { state_id: string }) => r.state_id);
}

export async function deleteStateDocument(
  client: PoolClient,
  params: {
    stateId: string;
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
  },
): Promise<void> {
  await client.query({
    ...DELETE_STATE_DOCUMENT,
    values: [params.stateId, params.activityIri, params.agentIfi, params.registration ?? null],
  });
}

export async function deleteAllStateDocuments(
  client: PoolClient,
  params: {
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
    since: string | undefined;
  },
): Promise<void> {
  await client.query({
    ...DELETE_STATE_DOCUMENTS,
    values: [
      params.activityIri,
      params.agentIfi,
      params.registration ?? null,
      params.since ?? null,
    ],
  });
}
