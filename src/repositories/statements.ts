/**
 * xAPI Statement Repository — lrsql-compatible normalized storage.
 *
 * Insert: generate SQUUID for id, decompose statement into xapi_statement +
 *         actor + activity + junction rows. Bake stored/authority into payload.
 * Query:  JOIN on statement_to_actor/statement_to_activity. Paginate by SQUUID id.
 * Void:   UPDATE xapi_statement SET is_voided = true WHERE statement_id = $1.
 */

import type { QueryConfig } from 'pg';
import type { DbClient } from '../db.ts';
import { HttpError } from '../db.ts';
import { canonicalAgentIfi } from '../helpers/agent.ts';
import { squuid, squuidMin } from '../helpers/squuid.ts';
import { buildPayload, extractActors, extractActivities } from './statement-decomposition.ts';

type Query = Omit<QueryConfig, 'values'>;

// ============================================================================
// Types
// ============================================================================

export interface XapiStatementRow {
  id: string;
  statement_id: string;
  payload: Record<string, unknown>;
  is_voided: boolean;
  stored: Date;
}

export interface StatementQueryParams {
  agent?: string;
  verb?: string;
  activity?: string;
  registration?: string;
  related_activities?: boolean;
  related_agents?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  ascending?: boolean;
  cursor?: string;
  /** Page size when `limit` is not provided (defaults to 50 if unset). */
  defaultLimit?: number;
  /** Hard cap on any user-supplied `limit` (defaults to 50 if unset). */
  maxLimit?: number;
}

// ============================================================================
// Statement insert
// ============================================================================

const INSERT_XAPI_STATEMENT = {
  name: 'insert_xapi_statement',
  text: `INSERT INTO xapi_statement (id, statement_id, registration, verb_iri, is_voided, payload, timestamp, stored)
         VALUES ($1, $2, $3, $4, false, $5, $6, $7)
         ON CONFLICT (statement_id) DO NOTHING`,
} as const satisfies Query;

/**
 * Batch-upsert actors and insert statement_to_actor rows in a single query.
 * Uses a CTE with UNNEST to avoid per-row round-trips.
 */
const BATCH_UPSERT_ACTORS = {
  name: 'batch_upsert_actors',
  text: `WITH unique_actors AS (
           SELECT DISTINCT ON (ifi, atype)
                  ifi, atype, apayload
             FROM UNNEST($1::text[], $2::text[], $5::json[])
               AS t(ifi, atype, apayload)
         ),
         upserted AS (
           INSERT INTO actor (id, payload, actor_ifi, actor_type)
           SELECT gen_random_uuid(), ua.apayload, ua.ifi, ua.atype::actor_type_enum
             FROM unique_actors ua
           ON CONFLICT (actor_ifi, actor_type) DO NOTHING
         )
         -- lrsql has no unique constraint on statement_to_actor and does no
         -- junction dedup (plain INSERTs, insert.sql:43-51); a bare
         -- ON CONFLICT here can never fire and would read as protection it
         -- isn't. Duplicate-row prevention across re-POSTs is handled by the
         -- statement-insert gating above (this query never runs when the
         -- statement row itself didn't insert), and within-statement
         -- duplicates are deduped by extractActors before this query runs.
         INSERT INTO statement_to_actor (id, statement_id, usage, actor_ifi, actor_type)
         SELECT gen_random_uuid(), $3::uuid, u.usage::actor_usage_enum, u.ifi, u.atype::actor_type_enum
           FROM UNNEST($1::text[], $2::text[], $4::text[])
             AS u(ifi, atype, usage)`,
} as const satisfies Query;

/**
 * Batch-upsert activities and insert statement_to_activity rows in a single query.
 * Uses a CTE with UNNEST to avoid per-row round-trips.
 */
const BATCH_UPSERT_ACTIVITIES = {
  name: 'batch_upsert_activities',
  text: `WITH unique_activities AS (
           SELECT DISTINCT ON (iri)
                  iri, payload
             FROM UNNEST($1::text[], $2::json[])
               AS t(iri, payload)
         ),
         upserted AS (
           INSERT INTO activity (id, payload, activity_iri)
           SELECT gen_random_uuid(), ua.payload, ua.iri
             FROM unique_activities ua
           ON CONFLICT (activity_iri)
           DO UPDATE SET payload = EXCLUDED.payload
         )
         -- No unique constraint on statement_to_activity either; see the
         -- comment on the statement_to_actor insert above — the bare
         -- ON CONFLICT DO NOTHING removed here could never fire.
         INSERT INTO statement_to_activity (id, statement_id, usage, activity_iri)
         SELECT gen_random_uuid(), $3::uuid, u.usage::activity_usage_enum, u.iri
           FROM UNNEST($1::text[], $4::text[])
             AS u(iri, usage)`,
} as const satisfies Query;

const INSERT_STATEMENT_TO_STATEMENT = {
  name: 'insert_statement_to_statement',
  // lrsql v0.9.5 semantics (ops/command/statement.clj + query.sql
  // stmt-ref-subquery): ancestor_id = the NEW referencing statement ($1),
  // descendant_id = the referenced target. lrsql also inserts TRANSITIVE
  // links — the referencer additionally links to each of the target's own
  // descendants — so the second UNION branch copies (target -> d) rows as
  // (referencer -> d). UNION (not UNION ALL) dedupes the direct link
  // against a hypothetical target self-link.
  //
  // Both columns carry NOT NULL FKs to xapi_statement(statement_id)
  // (lrsql's ancestor_fk/descendant_fk), but per xAPI Data 2.3.2 a
  // Statement MAY reference (e.g. void) a StatementRef target the LRS has
  // never seen — "the LRS SHOULD NOT reject the request on the grounds of
  // the Object of that voiding Statement not being present" — so the
  // direct link is gated on the DESCENDANT (target, $2) existing, or this
  // would 500 on the FK violation instead of silently skipping the row.
  // (ancestor_id is always safe: it's the statement we just inserted in
  // this same call; transitive descendants exist by FK on the copied rows.)
  text: `INSERT INTO statement_to_statement (id, ancestor_id, descendant_id)
         SELECT gen_random_uuid(), $1, d.descendant_id
         FROM (
           SELECT $2::uuid AS descendant_id
            WHERE EXISTS (SELECT 1 FROM xapi_statement WHERE statement_id = $2)
           UNION
           SELECT sts.descendant_id
             FROM statement_to_statement sts
            WHERE sts.ancestor_id = $2
         ) AS d`,
} as const satisfies Query;

export interface InsertStatementResult {
  inserted: boolean;
  id: string;
  statementId: string;
}

export async function insertStatement(
  client: DbClient,
  statement: Record<string, unknown>,
  authority: Record<string, unknown>,
): Promise<InsertStatementResult> {
  const statementId = statement.id as string;
  const verbIri = ((statement.verb as Record<string, unknown>)?.id as string) ?? '';
  const now = new Date();
  const storedIso = now.toISOString();
  // xapi_statement.id is the pagination-key SQUUID (hand-rolled, v4-nibble —
  // see src/helpers/squuid.ts); statement.id (the xAPI id, statement_id
  // column) is generated as a UUIDv7 in statement-validator.ts when absent.
  // Both sort correctly against lrsql's own SQUUID-layout ids; see the plan
  // header "Verified upstream facts" — do not conflate the two id schemes.
  const id = squuid(now.getTime());

  const payload = buildPayload(statement, storedIso, authority);
  // registration/timestamp are explicit columns per lrsql's shape (registration
  // UUID, timestamp TIMESTAMPTZ, both nullable with no DB-side default);
  // timestamp defaulting to "now" already happened in statement-validator.ts
  // when the client omitted it, so the baked payload's timestamp is
  // authoritative here.
  const registration =
    ((statement.context as Record<string, unknown> | undefined)?.registration as string | undefined) ?? null;
  const timestamp = (payload.timestamp as string | undefined) ?? null;

  const result = await client.query({
    ...INSERT_XAPI_STATEMENT,
    values: [id, statementId, registration, verbIri, JSON.stringify(payload), timestamp, storedIso],
  });

  // Gate ALL dependent inserts (actor/activity junctions, statement_to_statement,
  // and — via the `inserted` flag returned to callers — attachments in
  // routes/statements.ts) on the statement row itself having inserted. lrsql's
  // junction tables carry no unique constraints and get plain INSERTs with no
  // dedup, so re-POSTing an existing statementId (ON CONFLICT (statement_id)
  // DO NOTHING above => rowCount 0) must short-circuit here or duplicate
  // junction/attachment rows would accumulate on every re-POST.
  const inserted = (result.rowCount ?? 0) > 0;
  if (!inserted) return { inserted: false, id, statementId };

  // Decompose into entity + junction tables
  const actors = extractActors(payload);
  const activities = extractActivities(payload);

  // Batch upsert actors + junction rows
  if (actors.length > 0) {
    const ifis = actors.map((a) => a.ifi);
    const types = actors.map((a) => a.type);
    const usages = actors.map((a) => a.usage);
    const payloads = actors.map((a) => JSON.stringify(a.payload));
    await client.query({
      ...BATCH_UPSERT_ACTORS,
      values: [ifis, types, statementId, usages, payloads],
    });
  }

  // Batch upsert activities + junction rows
  if (activities.length > 0) {
    const iris = activities.map((a) => a.iri);
    const payloads = activities.map((a) => JSON.stringify(a.payload));
    const usages = activities.map((a) => a.usage);
    await client.query({
      ...BATCH_UPSERT_ACTIVITIES,
      values: [iris, payloads, statementId, usages],
    });
  }

  // StatementRef relationships: ancestor = this (referencing) statement,
  // descendant = the referenced target (lrsql column semantics; see
  // INSERT_STATEMENT_TO_STATEMENT).
  const obj = payload.object as Record<string, unknown> | undefined;
  if (obj?.objectType === 'StatementRef' && obj.id) {
    await client.query({
      ...INSERT_STATEMENT_TO_STATEMENT,
      values: [statementId, obj.id as string],
    });
  }

  return { inserted: true, id, statementId };
}

export async function insertStatements(
  client: DbClient,
  statements: Record<string, unknown>[],
  authority: Record<string, unknown>,
): Promise<InsertStatementResult[]> {
  const results: InsertStatementResult[] = [];
  for (const stmt of statements) {
    results.push(await insertStatement(client, stmt, authority));
  }
  return results;
}

// ============================================================================
// Statement lookup
// ============================================================================

const SELECT_STATEMENT_BY_ID = {
  name: 'select_statement_by_id',
  text: `SELECT id, statement_id, payload, is_voided, stored
         FROM xapi_statement WHERE statement_id = $1`,
} as const satisfies Query;

export async function getStatementById(client: DbClient, statementId: string): Promise<XapiStatementRow | undefined> {
  const result = await client.query({ ...SELECT_STATEMENT_BY_ID, values: [statementId] });
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    statement_id: row.statement_id,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    is_voided: row.is_voided,
    stored: row.stored,
  };
}

// ============================================================================
// Voiding
// ============================================================================

const VOID_STATEMENT = {
  name: 'void_statement',
  text: `UPDATE xapi_statement SET is_voided = true WHERE statement_id = $1 AND is_voided = false`,
} as const satisfies Query;

export async function voidStatement(client: DbClient, statementId: string): Promise<boolean> {
  const result = await client.query({ ...VOID_STATEMENT, values: [statementId] });
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Consistent Through
// ============================================================================

const SELECT_CONSISTENT_THROUGH = {
  name: 'select_consistent_through',
  text: `SELECT now() AS consistent_through`,
} as const satisfies Query;

export async function getConsistentThrough(client: DbClient): Promise<string> {
  const result = await client.query(SELECT_CONSISTENT_THROUGH);
  const row = result.rows[0] as { consistent_through: Date };
  return row.consistent_through.toISOString();
}

// ============================================================================
// Activity Object (merged definition)
// ============================================================================

export async function getActivityDefinition(client: DbClient, activityIri: string): Promise<Record<string, unknown>> {
  // Query all statement payloads that reference this activity as their object,
  // so we can merge definitions from multiple statements.
  const result = await client.query({
    name: 'get_activity_definitions',
    text: `SELECT s.payload
           FROM xapi_statement s
           JOIN statement_to_activity sta ON sta.statement_id = s.statement_id
           WHERE sta.activity_iri = $1 AND sta.usage = 'Object'`,
    values: [activityIri],
  });

  if (result.rows.length === 0) {
    return { objectType: 'Activity', id: activityIri };
  }

  // Merge definitions from all statements that reference this activity
  let mergedDef: Record<string, unknown> = {};
  for (const row of result.rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const obj = payload.object as Record<string, unknown> | undefined;
    if (obj?.definition && typeof obj.definition === 'object') {
      const def = obj.definition as Record<string, unknown>;
      // Deep-merge Language Maps within the definition
      for (const [key, value] of Object.entries(def)) {
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          mergedDef[key] &&
          typeof mergedDef[key] === 'object' &&
          !Array.isArray(mergedDef[key])
        ) {
          // Merge Language Maps (name, description) or other nested objects
          mergedDef[key] = {
            ...(mergedDef[key] as Record<string, unknown>),
            ...(value as Record<string, unknown>),
          };
        } else {
          mergedDef[key] = value;
        }
      }
    }
  }

  const activity: Record<string, unknown> = { objectType: 'Activity', id: activityIri };
  if (Object.keys(mergedDef).length > 0) {
    activity.definition = mergedDef;
  }
  return activity;
}

// ============================================================================
// Statement Query (with JOIN-based filtering)
// ============================================================================

export async function queryStatements(
  client: DbClient,
  params: StatementQueryParams,
): Promise<{ rows: XapiStatementRow[]; hasMore: boolean }> {
  // Separate content filters (verb/agent/activity/registration) from time filters
  // (since/until). Per xAPI spec §2.4.1: "The LRS MUST still return any Statements
  // targeting the voided Statement." When a voided statement matches the content
  // filters, statements referencing it (voiding + StatementRef) must also be
  // returned even if they don't match the content filters themselves.
  const directContentConds: string[] = [];
  const voidedContentConds: string[] = [];
  const timeConds: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.verb) {
    directContentConds.push(`s.verb_iri = $${paramIndex}`);
    voidedContentConds.push(`v.verb_iri = $${paramIndex}`);
    values.push(params.verb);
    paramIndex++;
  }

  if (params.agent) {
    let agentIfi: string;
    try {
      agentIfi = canonicalAgentIfi(params.agent);
    } catch {
      throw new HttpError(400, 'agent parameter is not valid JSON');
    }

    // lrsql parity (query.sql postgres-actors-join): group members are now
    // written under the group's positional usage (extractActors), not a
    // dedicated 'Member' usage. So a plain `agent` filter (usage = 'Actor')
    // already matches both the top-level actor AND any actor-position group
    // member — no extra join/condition needed. `related_agents=true` drops
    // the usage filter entirely and matches ANY row for this IFI, including
    // Sub*/Team/Instructor/Authority positions.
    if (params.related_agents) {
      directContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_actor sta WHERE sta.statement_id = s.statement_id AND sta.actor_ifi = $${paramIndex})`,
      );
      voidedContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_actor sta WHERE sta.statement_id = v.statement_id AND sta.actor_ifi = $${paramIndex})`,
      );
    } else {
      directContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_actor sta WHERE sta.statement_id = s.statement_id AND sta.usage = 'Actor' AND sta.actor_ifi = $${paramIndex})`,
      );
      voidedContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_actor sta WHERE sta.statement_id = v.statement_id AND sta.usage = 'Actor' AND sta.actor_ifi = $${paramIndex})`,
      );
    }
    values.push(agentIfi);
    paramIndex++;
  }

  if (params.activity) {
    if (params.related_activities) {
      directContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_activity stact WHERE stact.statement_id = s.statement_id AND stact.activity_iri = $${paramIndex})`,
      );
      voidedContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_activity stact WHERE stact.statement_id = v.statement_id AND stact.activity_iri = $${paramIndex})`,
      );
    } else {
      directContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_activity stact WHERE stact.statement_id = s.statement_id AND stact.usage = 'Object' AND stact.activity_iri = $${paramIndex})`,
      );
      voidedContentConds.push(
        `EXISTS (SELECT 1 FROM statement_to_activity stact WHERE stact.statement_id = v.statement_id AND stact.usage = 'Object' AND stact.activity_iri = $${paramIndex})`,
      );
    }
    values.push(params.activity);
    paramIndex++;
  }

  if (params.registration) {
    directContentConds.push(`s.payload->'context'->>'registration' = $${paramIndex}`);
    voidedContentConds.push(`v.payload->'context'->>'registration' = $${paramIndex}`);
    values.push(params.registration);
    paramIndex++;
  }

  if (params.cursor) {
    // Pagination cursor: use the exact SQUUID from the previous page boundary.
    // ascending uses >, descending uses < (both exclusive — cursor row not repeated).
    timeConds.push(params.ascending ? `s.id > $${paramIndex}` : `s.id < $${paramIndex}`);
    values.push(params.cursor);
    paramIndex++;
    // Preserve the opposite time bound from the original query if present.
    if (params.ascending && params.until) {
      timeConds.push(`s.id <= $${paramIndex}`);
      values.push(squuidMin(new Date(params.until).getTime()));
      paramIndex++;
    } else if (!params.ascending && params.since) {
      timeConds.push(`s.id > $${paramIndex}`);
      values.push(squuidMin(new Date(params.since).getTime()));
      paramIndex++;
    }
  } else {
    if (params.since) {
      timeConds.push(`s.id > $${paramIndex}`);
      values.push(squuidMin(new Date(params.since).getTime()));
      paramIndex++;
    }
    if (params.until) {
      timeConds.push(`s.id <= $${paramIndex}`);
      values.push(squuidMin(new Date(params.until).getTime()));
      paramIndex++;
    }
  }

  const defaultLimit = params.defaultLimit ?? 50;
  const maxLimit = params.maxLimit ?? 50;
  const effectiveLimit = Math.min(params.limit ?? defaultLimit, maxLimit);
  const orderDir = params.ascending ? 'ASC' : 'DESC';

  // Build WHERE: direct matches OR statements targeting voided matches
  const directWhere = ['s.is_voided = false', ...directContentConds, ...timeConds].join(' AND ');

  let whereClause: string;
  if (voidedContentConds.length > 0) {
    const voidedFilter = voidedContentConds.join(' AND ');
    // lrsql direction: ancestor_id = the referencing statement (s here),
    // descendant_id = the referenced/voided target (v). Transitive rows
    // written at insert time mean s matches for the whole reference chain,
    // matching lrsql's stmt-ref-subquery behavior.
    const targetingExists = `EXISTS (
      SELECT 1 FROM statement_to_statement sts
      JOIN xapi_statement v ON v.statement_id = sts.descendant_id
        AND v.is_voided = true AND ${voidedFilter}
      WHERE sts.ancestor_id = s.statement_id
    )`;
    const targetingWhere = ['s.is_voided = false', ...timeConds, targetingExists].join(' AND ');
    whereClause = `(${directWhere}) OR (${targetingWhere})`;
  } else {
    whereClause = directWhere;
  }

  const queryText = `SELECT s.id, s.statement_id, s.payload, s.is_voided, s.stored
                     FROM xapi_statement s
                     WHERE ${whereClause}
                     ORDER BY s.id ${orderDir}
                     LIMIT $${paramIndex}`;

  values.push(effectiveLimit + 1);

  const result = await client.query({ text: queryText, values });
  const rows: XapiStatementRow[] = result.rows.map((r) => ({
    id: r.id,
    statement_id: r.statement_id,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    is_voided: r.is_voided,
    stored: r.stored,
  }));

  const hasMore = rows.length > effectiveLimit;
  if (hasMore) rows.pop();

  return { rows, hasMore };
}
