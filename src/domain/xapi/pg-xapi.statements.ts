import crypto from 'node:crypto';
import type pg from 'pg';
import type {
  Activity,
  Agent,
  Statement,
  StatementQuery,
  StatementResult,
} from './types.js';
import { actorToIfi, agentToIfi } from './agent-ifi.js';
import { HttpError } from '../../core/errors.js';
import type { XapiAuthority } from '../../core/context.js';
import type { Queryable } from './pg-xapi.shared.js';
import { extractAllActivities, upsertAgentOnClient, upsertActivityOnClient } from './pg-xapi.shared.js';

type PgQuery = Omit<pg.QueryConfig, 'values'>;

const TENANT_ID_EXPR = `current_setting('request.tenant.id')::UUID`;

const VOIDED_VERB = 'http://adlnet.gov/expapi/verbs/voided';

const STMT_INSERT: PgQuery = {
  name: 'xapi_stmt_insert',
  text: `INSERT INTO xapi.statements (tenant_id, id, verb_id, actor_ifi, activity_id, registration, "timestamp", raw)
         VALUES (${TENANT_ID_EXPR}, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
};

const STMT_VOID_TARGET: PgQuery = {
  name: 'xapi_stmt_void_target',
  text: `UPDATE xapi.statements SET voided = TRUE WHERE id = $1 AND voided = FALSE AND verb_id != 'http://adlnet.gov/expapi/verbs/voided'`,
};

const STMT_GET: PgQuery = {
  name: 'xapi_stmt_get',
  text: `SELECT raw FROM xapi.statements WHERE id = $1 AND voided = FALSE`,
};

const STMT_GET_VOIDED: PgQuery = {
  name: 'xapi_stmt_get_voided',
  text: `SELECT raw FROM xapi.statements WHERE id = $1 AND voided = TRUE`,
};

const STMT_GET_RAW: PgQuery = {
  name: 'xapi_stmt_get_raw',
  text: `SELECT raw FROM xapi.statements WHERE id = $1`,
};

const STMT_CONSISTENT_THROUGH: PgQuery = {
  name: 'xapi_stmt_consistent_through',
  text: `SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS max_stored`,
};

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  stored: string;
  id: string;
}

export function encodeCursor(stored: string, id: string): string {
  return Buffer.from(JSON.stringify({ stored, id })).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  const json = Buffer.from(cursor, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.stored !== 'string' || typeof parsed.id !== 'string') {
    throw new Error('Invalid cursor');
  }
  return { stored: parsed.stored as string, id: parsed.id as string };
}

// ---------------------------------------------------------------------------
// Related-filter SQL helpers
// ---------------------------------------------------------------------------

export function ifiToJsonbContains(ifi: string): string {
  const colonIdx = ifi.indexOf(':');
  const type = ifi.substring(0, colonIdx);
  const value = ifi.substring(colonIdx + 1);

  if (type === 'account') {
    const pipeIdx = value.indexOf('|');
    return JSON.stringify({ account: { homePage: value.substring(0, pipeIdx), name: value.substring(pipeIdx + 1) } });
  }

  return JSON.stringify({ [type]: value });
}

function relatedActivitiesCondition(activityParam: string, containsParam: string): string {
  return [
    `activity_id = ${activityParam}`,
    `raw->'context'->'contextActivities'->'parent' @> ${containsParam}::jsonb`,
    `raw->'context'->'contextActivities'->'grouping' @> ${containsParam}::jsonb`,
    `raw->'context'->'contextActivities'->'category' @> ${containsParam}::jsonb`,
    `raw->'context'->'contextActivities'->'other' @> ${containsParam}::jsonb`,
    `(raw->'object'->>'objectType' = 'SubStatement' AND raw->'object'->'object'->>'id' = ${activityParam})`,
    `raw->'object'->'context'->'contextActivities'->'parent' @> ${containsParam}::jsonb`,
    `raw->'object'->'context'->'contextActivities'->'grouping' @> ${containsParam}::jsonb`,
    `raw->'object'->'context'->'contextActivities'->'category' @> ${containsParam}::jsonb`,
    `raw->'object'->'context'->'contextActivities'->'other' @> ${containsParam}::jsonb`,
  ].join(' OR ');
}

function relatedAgentsCondition(ifiParam: string, containsParam: string): string {
  return [
    `actor_ifi = ${ifiParam}`,
    `raw->'object' @> ${containsParam}::jsonb`,
    `raw->'authority' @> ${containsParam}::jsonb`,
    `raw->'context'->'instructor' @> ${containsParam}::jsonb`,
    `raw->'context'->'team' @> ${containsParam}::jsonb`,
    `raw->'object'->'actor' @> ${containsParam}::jsonb`,
    `raw->'object'->'object' @> ${containsParam}::jsonb`,
    `raw->'object'->'context'->'instructor' @> ${containsParam}::jsonb`,
    `raw->'object'->'context'->'team' @> ${containsParam}::jsonb`,
  ].join(' OR ');
}

export function statementsMatch(incoming: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  const strip = ({ stored: _s, version: _v, authority: _a, timestamp: _t, ...rest }: Record<string, unknown>) => rest;
  return JSON.stringify(strip(incoming)) === JSON.stringify(strip(existing));
}

function extractActivity(stmt: Statement): Activity | null {
  if (!stmt.object || !('id' in stmt.object)) return null;
  const objType = 'objectType' in stmt.object ? stmt.object.objectType : undefined;
  if (objType && objType !== 'Activity') return null;
  return stmt.object as Activity;
}

export async function storeStatements(
  q: Queryable,
  statements: readonly Statement[],
  authority?: XapiAuthority,
  options?: { skipDefine?: boolean },
): Promise<readonly string[]> {
  const ids: string[] = [];

  for (const stmt of statements) {
    const id = stmt.id ?? crypto.randomUUID();
    ids.push(id);

    const actorIfi = actorToIfi(stmt.actor);
    const verbId = stmt.verb.id;
    const activity = extractActivity(stmt);
    const activityId = activity?.id ?? null;
    const registration = stmt.context?.registration ?? null;
    const now = new Date().toISOString();
    const timestamp = stmt.timestamp ?? now;
    const stored = now;
    const stmtAuthority = stmt.authority ?? authority;
    const raw = { ...stmt, id, timestamp, stored, version: '1.0.3', ...(stmtAuthority ? { authority: stmtAuthority } : {}) };

    const insertResult = await q.query({ ...STMT_INSERT, values: [id, verbId, actorIfi, activityId, registration, timestamp, JSON.stringify(raw)] });

    if (insertResult.rowCount === 0) {
      const { rows } = await q.query<{ raw: Record<string, unknown> }>({ ...STMT_GET_RAW, values: [id] });
      const existingRaw = rows[0]?.raw;
      if (existingRaw && !statementsMatch(raw, existingRaw)) {
        throw new HttpError(409, 'CONFLICT', `A statement with id "${id}" already exists with different content`);
      }
      continue;
    }

    if (verbId === VOIDED_VERB && stmt.object && 'objectType' in stmt.object && stmt.object.objectType === 'StatementRef') {
      await q.query({ ...STMT_VOID_TARGET, values: [stmt.object.id] });
    }

    if (!options?.skipDefine) {
      for (const act of extractAllActivities(stmt)) {
        await upsertActivityOnClient(q, act.id, act.definition);
      }
    }

    if (actorIfi) {
      await upsertAgentOnClient(q, stmt.actor as Agent, actorIfi);
    }
  }

  return ids;
}

export async function getStatement(q: Queryable, id: string): Promise<Statement | null> {
  const { rows } = await q.query<{ raw: Statement }>({ ...STMT_GET, values: [id] });
  return rows[0]?.raw ?? null;
}

export async function getVoidedStatement(q: Queryable, id: string): Promise<Statement | null> {
  const { rows } = await q.query<{ raw: Statement }>({ ...STMT_GET_VOIDED, values: [id] });
  return rows[0]?.raw ?? null;
}

export async function getConsistentThrough(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ max_stored: string }>(STMT_CONSISTENT_THROUGH);
  return rows[0]?.max_stored ?? new Date().toISOString();
}

export async function queryStatements(
  q: Queryable,
  query: StatementQuery,
  options?: { authorityIfi?: string },
): Promise<StatementResult> {
  const conditions: string[] = ['voided = FALSE'];
  const params: unknown[] = [];
  let idx = 1;

  if (options?.authorityIfi) {
    conditions.push(`raw->'authority' @> $${String(idx++)}::jsonb`);
    params.push(ifiToJsonbContains(options.authorityIfi));
  }

  if (query.verb) {
    conditions.push(`verb_id = $${String(idx++)}`);
    params.push(query.verb);
  }
  if (query.activity) {
    if (query.related_activities) {
      const activityParam = `$${String(idx++)}`;
      params.push(query.activity);
      const containsParam = `$${String(idx++)}`;
      params.push(JSON.stringify([{ id: query.activity }]));
      conditions.push(`(${relatedActivitiesCondition(activityParam, containsParam)})`);
    } else {
      conditions.push(`activity_id = $${String(idx++)}`);
      params.push(query.activity);
    }
  }
  if (query.registration) {
    conditions.push(`registration = $${String(idx++)}`);
    params.push(query.registration);
  }
  if (query.agent) {
    const ifi = agentToIfi(query.agent);
    if (query.related_agents) {
      const ifiParam = `$${String(idx++)}`;
      params.push(ifi);
      const containsParam = `$${String(idx++)}`;
      params.push(ifiToJsonbContains(ifi));
      conditions.push(`(${relatedAgentsCondition(ifiParam, containsParam)})`);
    } else {
      conditions.push(`actor_ifi = $${String(idx++)}`);
      params.push(ifi);
    }
  }

  const timeConditions: string[] = [];
  if (query.since) {
    timeConditions.push(`stored > $${String(idx++)}`);
    params.push(query.since);
  }
  if (query.until) {
    timeConditions.push(`stored <= $${String(idx++)}`);
    params.push(query.until);
  }
  conditions.push(...timeConditions);

  const ascending = query.ascending === true;
  const orderDir = ascending ? 'ASC' : 'DESC';
  const comp = ascending ? '>' : '<';
  const limit = query.limit && query.limit > 0 ? query.limit : 100;

  if (query.cursor) {
    const cur = decodeCursor(query.cursor);
    conditions.push(`(stored, id) ${comp} ($${String(idx++)}, $${String(idx++)})`);
    params.push(cur.stored, cur.id);
  }

  const voidedTargetConditions = conditions.map((c) =>
    c === 'voided = FALSE' ? 'voided = TRUE' : c,
  );
  const voidingConditions = [
    `voided = FALSE`,
    `verb_id = 'http://adlnet.gov/expapi/verbs/voided'`,
    `raw->'object'->>'objectType' = 'StatementRef'`,
    `(raw->'object'->>'id') IN (SELECT id::text FROM xapi.statements WHERE ${voidedTargetConditions.join(' AND ')})`,
    ...timeConditions,
  ];

  const sql = `SELECT raw, stored, id FROM (
    SELECT raw, stored, id FROM xapi.statements
      WHERE ${conditions.join(' AND ')}
    UNION
    SELECT raw, stored, id FROM xapi.statements
      WHERE ${voidingConditions.join(' AND ')}
  ) combined
    ORDER BY stored ${orderDir}, id ${orderDir}
    LIMIT $${String(idx++)}`;
  params.push(limit + 1);

  const { rows } = await q.query<{ raw: Statement; stored: string; id: string }>(sql, params);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const stmts = page.map((r) => r.raw);

  let more: string | undefined;
  if (hasMore) {
    const lastRow = page[page.length - 1];
    if (lastRow) {
      more = `/xapi/statements?cursor=${encodeCursor(lastRow.stored, lastRow.id)}`;
    }
  }

  return { statements: stmts, more };
}
