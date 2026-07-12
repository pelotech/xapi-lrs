/**
 * xAPI Activity State Repository — lrsql state_document table.
 */

import type { QueryConfig } from 'pg';
import type { DbClient } from '../db.ts';

type Query = Omit<QueryConfig, 'values'>;

// lrsql upserts state documents app-side (select-then-update/insert), not via
// ON CONFLICT: its state_doc_idx is UNIQUE(state_id, activity_iri, agent_ifi,
// registration) and Postgres treats NULL registrations as DISTINCT, so a single
// ON CONFLICT target cannot cover both the registration-scoped and the
// no-registration cases. `registration IS NOT DISTINCT FROM $4` is the NULL-safe
// match predicate (matches the no-registration row when $4 is NULL).
const UPDATE_STATE_DOCUMENT = {
  name: 'update_state_document',
  text: `UPDATE state_document
     SET last_modified = $5, content_type = $6, content_length = $7, contents = $8
     WHERE state_id = $1 AND activity_iri = $2 AND agent_ifi = $3
       AND registration IS NOT DISTINCT FROM $4`,
} as const satisfies Query;

const INSERT_STATE_DOCUMENT = {
  name: 'insert_state_document',
  text: `INSERT INTO state_document (id, state_id, activity_iri, agent_ifi, registration, last_modified, content_type, content_length, contents)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
} as const satisfies Query;

// Savepoint control for the insert retry. Kept unnamed (simple protocol) and
// scoped to the caller's transaction so a unique violation doesn't poison it.
const SAVEPOINT_STATE_INSERT = { text: 'SAVEPOINT state_doc_insert' } as const satisfies Query;
const RELEASE_STATE_INSERT = { text: 'RELEASE SAVEPOINT state_doc_insert' } as const satisfies Query;
const ROLLBACK_STATE_INSERT = { text: 'ROLLBACK TO SAVEPOINT state_doc_insert' } as const satisfies Query;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

const SELECT_STATE_DOCUMENT = {
  name: 'select_state_document',
  text: `SELECT contents, content_type, content_length, last_modified FROM state_document
     WHERE state_id = $1 AND activity_iri = $2 AND agent_ifi = $3
       AND (registration = $4 OR ($4 IS NULL AND registration IS NULL))`,
} as const satisfies Query;

const SELECT_STATE_IDS = {
  name: 'select_state_ids',
  text: `SELECT state_id FROM state_document
     WHERE activity_iri = $1 AND agent_ifi = $2
       AND (registration = $3 OR ($3 IS NULL AND registration IS NULL))
       AND ($4::timestamptz IS NULL OR last_modified > $4)`,
} as const satisfies Query;

const DELETE_STATE_DOCUMENT = {
  name: 'delete_state_document',
  text: `DELETE FROM state_document
     WHERE state_id = $1 AND activity_iri = $2 AND agent_ifi = $3
       AND (registration = $4 OR ($4 IS NULL AND registration IS NULL))`,
} as const satisfies Query;

const DELETE_STATE_DOCUMENTS = {
  name: 'delete_state_documents',
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

/**
 * Upsert a state document (lrsql app-side UPDATE-then-INSERT).
 *
 * Invariant: MUST be called within an already-open transaction — it issues one
 * insert-retry SAVEPOINT (`state_doc_insert`) per call. A future caller batching
 * two state writes in one transaction is fine (the savepoint is created, used,
 * and released within a single call), but must not itself hold an open savepoint
 * of the same name.
 */
export async function upsertStateDocument(
  client: DbClient,
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
  const values = [
    params.stateId,
    params.activityIri,
    params.agentIfi,
    params.registration ?? null,
    params.lastModified,
    params.contentType,
    params.contents.length,
    params.contents,
  ];

  // App-side upsert matching lrsql semantics: UPDATE first, INSERT only when no
  // row matched. The route layer (src/routes/activities.ts) has already computed
  // `contents` — raw body for PUT (replace), merged JSON for POST — so this repo
  // just persists whatever it is given; the merge-vs-replace decision stays there.
  const updated = await client.query({ ...UPDATE_STATE_DOCUMENT, values });
  if ((updated.rowCount ?? 0) > 0) return;

  // No existing row — insert. Two writers can race to this point:
  //  - NULL registration: there is no unique constraint (neither has lrsql), so a
  //    lost-update race is last-write-wins, matching lrsql's semantics exactly.
  //  - Non-NULL registration: state_doc_idx backstops us. A concurrent insert
  //    makes ours raise 23505; by the time that surfaces the other writer has
  //    committed, so the row is now visible and a retried UPDATE matches it.
  // The SAVEPOINT keeps the retry inside the caller's transaction (all callers
  // wrap this in withClient); without it the 23505 would abort the whole tx.
  try {
    await client.query(SAVEPOINT_STATE_INSERT);
    await client.query({ ...INSERT_STATE_DOCUMENT, values });
    await client.query(RELEASE_STATE_INSERT);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await client.query(ROLLBACK_STATE_INSERT);
    // The retried UPDATE may legitimately match 0 rows if the concurrently
    // inserted row was deleted between our failed INSERT and this retry — benign
    // last-write-wins, matching lrsql (no error, the delete simply won).
    await client.query({ ...UPDATE_STATE_DOCUMENT, values });
    // Release for symmetry with the success path. Harmless today (the savepoint
    // is freed at COMMIT regardless), but tidier and safe against future reuse.
    await client.query(RELEASE_STATE_INSERT);
  }
}

export async function getStateDocument(
  client: DbClient,
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
  client: DbClient,
  params: {
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
    since: string | undefined;
  },
): Promise<string[]> {
  const result = await client.query({
    ...SELECT_STATE_IDS,
    values: [params.activityIri, params.agentIfi, params.registration ?? null, params.since ?? null],
  });
  return result.rows.map((r: { state_id: string }) => r.state_id);
}

export async function deleteStateDocument(
  client: DbClient,
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
  client: DbClient,
  params: {
    activityIri: string;
    agentIfi: string;
    registration: string | undefined;
    since: string | undefined;
  },
): Promise<void> {
  await client.query({
    ...DELETE_STATE_DOCUMENTS,
    values: [params.activityIri, params.agentIfi, params.registration ?? null, params.since ?? null],
  });
}
