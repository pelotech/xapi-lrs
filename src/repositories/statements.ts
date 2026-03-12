/**
 * xAPI Statement Repository — lrsql-compatible normalized storage.
 *
 * Insert: generate SQUUID for id, decompose statement into xapi_statement +
 *         actor + activity + junction rows. Bake stored/authority into payload.
 * Query:  JOIN on statement_to_actor/statement_to_activity. Paginate by SQUUID id.
 * Void:   UPDATE xapi_statement SET is_voided = true WHERE statement_id = $1.
 */

import type { PoolClient, QueryConfig } from "pg";
import { HttpError } from "../db.ts";
import { squuid, squuidMin } from "../helpers/squuid.ts";
import { canonicalAgentIfi, agentActorType } from "../helpers/agent.ts";

type Query = Omit<QueryConfig, "values">;

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
}

// ============================================================================
// Statement insert
// ============================================================================

const INSERT_XAPI_STATEMENT = {
  name: "insert_xapi_statement",
  text: `INSERT INTO xapi_statement (id, statement_id, verb_iri, is_voided, payload)
         VALUES ($1, $2, $3, false, $4)
         ON CONFLICT (statement_id) DO NOTHING`,
} as const satisfies Query;

/**
 * Batch-upsert actors and insert statement_to_actor rows in a single query.
 * Uses a CTE with UNNEST to avoid per-row round-trips.
 */
const BATCH_UPSERT_ACTORS = {
  name: "batch_upsert_actors",
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
         INSERT INTO statement_to_actor (id, statement_id, usage, actor_ifi, actor_type)
         SELECT gen_random_uuid(), $3::uuid, u.usage::actor_usage_enum, u.ifi, u.atype::actor_type_enum
           FROM UNNEST($1::text[], $2::text[], $4::text[])
             AS u(ifi, atype, usage)
         ON CONFLICT DO NOTHING`,
} as const satisfies Query;

/**
 * Batch-upsert activities and insert statement_to_activity rows in a single query.
 * Uses a CTE with UNNEST to avoid per-row round-trips.
 */
const BATCH_UPSERT_ACTIVITIES = {
  name: "batch_upsert_activities",
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
         INSERT INTO statement_to_activity (id, statement_id, usage, activity_iri)
         SELECT gen_random_uuid(), $3::uuid, u.usage::activity_usage_enum, u.iri
           FROM UNNEST($1::text[], $4::text[])
             AS u(iri, usage)
         ON CONFLICT DO NOTHING`,
} as const satisfies Query;

const INSERT_STATEMENT_TO_STATEMENT = {
  name: "insert_statement_to_statement",
  text: `INSERT INTO statement_to_statement (id, ancestor_id, descendant_id)
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT DO NOTHING`,
} as const satisfies Query;

/** Bake stored timestamp and authority into the payload before storing. */
function buildPayload(
  statement: Record<string, unknown>,
  storedIso: string,
  authority: Record<string, unknown>,
): Record<string, unknown> {
  return { ...statement, stored: storedIso, authority };
}

/** Build a minimal actor payload for storage (just name if present). */
function actorPayload(agent: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (agent.name) p.name = agent.name;
  return p;
}

type ActorEntry = {
  ifi: string;
  type: "Agent" | "Group";
  usage: string;
  payload: Record<string, unknown>;
};

/** Extract actors from a statement for junction table insertion. */
function extractActors(stmt: Record<string, unknown>): ActorEntry[] {
  const actors: ActorEntry[] = [];

  function tryPush(agent: Record<string, unknown>, type: "Agent" | "Group", usage: string): void {
    try {
      actors.push({ ifi: canonicalAgentIfi(agent), type, usage, payload: actorPayload(agent) });
    } catch {
      /* skip agents without valid IFI */
    }
  }

  const actor = stmt.actor as Record<string, unknown> | undefined;
  if (actor) {
    tryPush(actor, agentActorType(actor), "Actor");
    if (Array.isArray(actor.member)) {
      for (const m of actor.member as Record<string, unknown>[]) {
        tryPush(m, "Agent", "Member");
      }
    }
  }

  const obj = stmt.object as Record<string, unknown> | undefined;
  if (obj) {
    const objectType = obj.objectType as string | undefined;
    if (objectType === "Agent" || objectType === "Group") {
      tryPush(obj, agentActorType(obj), "Object");
    }
  }

  const authority = stmt.authority as Record<string, unknown> | undefined;
  if (authority) {
    tryPush(authority, agentActorType(authority), "Authority");
    if (Array.isArray(authority.member)) {
      for (const m of authority.member as Record<string, unknown>[]) {
        tryPush(m, "Agent", "Authority");
      }
    }
  }

  const ctx = stmt.context as Record<string, unknown> | undefined;
  if (ctx) {
    const instructor = ctx.instructor as Record<string, unknown> | undefined;
    if (instructor) tryPush(instructor, agentActorType(instructor), "Instructor");
    const team = ctx.team as Record<string, unknown> | undefined;
    if (team) {
      tryPush(team, agentActorType(team), "Team");
      if (Array.isArray(team.member)) {
        for (const m of team.member as Record<string, unknown>[]) {
          tryPush(m, "Agent", "Member");
        }
      }
    }
  }

  // SubStatement actors
  if (obj && (obj.objectType as string) === "SubStatement") {
    const subActor = obj.actor as Record<string, unknown> | undefined;
    if (subActor) tryPush(subActor, agentActorType(subActor), "Actor");
    const subObj = obj.object as Record<string, unknown> | undefined;
    if (subObj && (subObj.objectType === "Agent" || subObj.objectType === "Group")) {
      tryPush(subObj, agentActorType(subObj), "Object");
    }
  }

  return actors;
}

/** Extract activities from a statement for junction table insertion. */
function extractActivities(
  stmt: Record<string, unknown>,
): Array<{ iri: string; usage: string; payload: Record<string, unknown> }> {
  const activities: Array<{ iri: string; usage: string; payload: Record<string, unknown> }> = [];

  const obj = stmt.object as Record<string, unknown> | undefined;
  if (obj) {
    const objectType = (obj.objectType as string | undefined) ?? "Activity";
    if (objectType === "Activity" && obj.id) {
      activities.push({ iri: obj.id as string, usage: "Object", payload: obj });
    }
  }

  const ctx = stmt.context as Record<string, unknown> | undefined;
  if (ctx?.contextActivities && typeof ctx.contextActivities === "object") {
    const ca = ctx.contextActivities as Record<string, unknown>;
    const usageMap: Record<string, string> = {
      parent: "Parent",
      grouping: "Grouping",
      category: "Category",
      other: "Other",
    };
    for (const [key, usage] of Object.entries(usageMap)) {
      if (Array.isArray(ca[key])) {
        for (const a of ca[key] as Record<string, unknown>[]) {
          if (a.id) {
            activities.push({ iri: a.id as string, usage, payload: a });
          }
        }
      }
    }
  }

  // SubStatement activities
  if (obj && (obj.objectType as string) === "SubStatement") {
    const subObj = obj.object as Record<string, unknown> | undefined;
    const subObjType = (subObj?.objectType as string | undefined) ?? "Activity";
    if (subObj && subObjType === "Activity" && subObj.id) {
      activities.push({ iri: subObj.id as string, usage: "SubObject", payload: subObj });
    }

    const subCtx = obj.context as Record<string, unknown> | undefined;
    if (subCtx?.contextActivities && typeof subCtx.contextActivities === "object") {
      const sca = subCtx.contextActivities as Record<string, unknown>;
      const subUsageMap: Record<string, string> = {
        parent: "SubParent",
        grouping: "SubGrouping",
        category: "SubCategory",
        other: "SubOther",
      };
      for (const [key, usage] of Object.entries(subUsageMap)) {
        if (Array.isArray(sca[key])) {
          for (const a of sca[key] as Record<string, unknown>[]) {
            if (a.id) {
              activities.push({ iri: a.id as string, usage, payload: a });
            }
          }
        }
      }
    }
  }

  return activities;
}

export interface InsertStatementResult {
  inserted: boolean;
  id: string;
  statementId: string;
}

export async function insertStatement(
  client: PoolClient,
  statement: Record<string, unknown>,
  authority: Record<string, unknown>,
): Promise<InsertStatementResult> {
  const statementId = statement.id as string;
  const verbIri = ((statement.verb as Record<string, unknown>)?.id as string) ?? "";
  const now = new Date();
  const storedIso = now.toISOString();
  const id = squuid(now.getTime());

  const payload = buildPayload(statement, storedIso, authority);

  const result = await client.query({
    ...INSERT_XAPI_STATEMENT,
    values: [id, statementId, verbIri, JSON.stringify(payload)],
  });

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

  // StatementRef relationships
  const obj = payload.object as Record<string, unknown> | undefined;
  if (obj?.objectType === "StatementRef" && obj.id) {
    await client.query({
      ...INSERT_STATEMENT_TO_STATEMENT,
      values: [obj.id as string, statementId],
    });
  }

  return { inserted: true, id, statementId };
}

export async function insertStatements(
  client: PoolClient,
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
  name: "select_statement_by_id",
  text: `SELECT id, statement_id, payload, is_voided, stored
         FROM xapi_statement WHERE statement_id = $1`,
} as const satisfies Query;

export async function getStatementById(
  client: PoolClient,
  statementId: string,
): Promise<XapiStatementRow | undefined> {
  const result = await client.query({ ...SELECT_STATEMENT_BY_ID, values: [statementId] });
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    statement_id: row.statement_id,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    is_voided: row.is_voided,
    stored: row.stored,
  };
}

// ============================================================================
// Voiding
// ============================================================================

const VOID_STATEMENT = {
  name: "void_statement",
  text: `UPDATE xapi_statement SET is_voided = true WHERE statement_id = $1 AND is_voided = false`,
} as const satisfies Query;

export async function voidStatement(client: PoolClient, statementId: string): Promise<boolean> {
  const result = await client.query({ ...VOID_STATEMENT, values: [statementId] });
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Consistent Through
// ============================================================================

const SELECT_CONSISTENT_THROUGH = {
  name: "select_consistent_through",
  text: `SELECT now() AS consistent_through`,
} as const satisfies Query;

export async function getConsistentThrough(client: PoolClient): Promise<string> {
  const result = await client.query(SELECT_CONSISTENT_THROUGH);
  const row = result.rows[0] as { consistent_through: Date };
  return row.consistent_through.toISOString();
}

// ============================================================================
// Activity Object (merged definition)
// ============================================================================

export async function getActivityDefinition(
  client: PoolClient,
  activityIri: string,
): Promise<Record<string, unknown>> {
  // Query all statement payloads that reference this activity as their object,
  // so we can merge definitions from multiple statements.
  const result = await client.query({
    name: "get_activity_definitions",
    text: `SELECT s.payload
           FROM xapi_statement s
           JOIN statement_to_activity sta ON sta.statement_id = s.statement_id
           WHERE sta.activity_iri = $1 AND sta.usage = 'Object'`,
    values: [activityIri],
  });

  if (result.rows.length === 0) {
    return { objectType: "Activity", id: activityIri };
  }

  // Merge definitions from all statements that reference this activity
  let mergedDef: Record<string, unknown> = {};
  for (const row of result.rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const obj = payload.object as Record<string, unknown> | undefined;
    if (obj?.definition && typeof obj.definition === "object") {
      const def = obj.definition as Record<string, unknown>;
      // Deep-merge Language Maps within the definition
      for (const [key, value] of Object.entries(def)) {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          mergedDef[key] &&
          typeof mergedDef[key] === "object" &&
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

  const activity: Record<string, unknown> = { objectType: "Activity", id: activityIri };
  if (Object.keys(mergedDef).length > 0) {
    activity.definition = mergedDef;
  }
  return activity;
}

// ============================================================================
// Statement Query (with JOIN-based filtering)
// ============================================================================

export async function queryStatements(
  client: PoolClient,
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
      throw new HttpError(400, "agent parameter is not valid JSON");
    }

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

  // Since/until use SQUUID boundary comparison
  if (params.since) {
    const sinceMs = new Date(params.since).getTime();
    const sinceId = squuidMin(sinceMs);
    timeConds.push(`s.id > $${paramIndex}`);
    values.push(sinceId);
    paramIndex++;
  }

  if (params.until) {
    const untilMs = new Date(params.until).getTime();
    const untilId = squuidMin(untilMs);
    timeConds.push(`s.id <= $${paramIndex}`);
    values.push(untilId);
    paramIndex++;
  }

  const effectiveLimit = Math.min(params.limit ?? 100, 1000);
  const orderDir = params.ascending ? "ASC" : "DESC";

  // Build WHERE: direct matches OR statements targeting voided matches
  const directWhere = ["s.is_voided = false", ...directContentConds, ...timeConds].join(" AND ");

  let whereClause: string;
  if (voidedContentConds.length > 0) {
    const voidedFilter = voidedContentConds.join(" AND ");
    const targetingExists = `EXISTS (
      SELECT 1 FROM statement_to_statement sts
      JOIN xapi_statement v ON v.statement_id = sts.ancestor_id
        AND v.is_voided = true AND ${voidedFilter}
      WHERE sts.descendant_id = s.statement_id
    )`;
    const targetingWhere = ["s.is_voided = false", ...timeConds, targetingExists].join(" AND ");
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
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    is_voided: r.is_voided,
    stored: r.stored,
  }));

  const hasMore = rows.length > effectiveLimit;
  if (hasMore) rows.pop();

  return { rows, hasMore };
}
