import type pg from 'pg';
import type {
  Activity,
  ActivityDefinition,
  Agent,
  ContextActivities,
  Statement,
} from './types.js';

type PgQuery = Omit<pg.QueryConfig, 'values'>;

export type Queryable = Pick<pg.Pool, 'query'>;

const TENANT_ID_EXPR = `current_setting('request.tenant.id')::UUID`;

// ---------------------------------------------------------------------------
// Activity / Agent upsert on ingest
// ---------------------------------------------------------------------------

const ACTIVITY_UPSERT: PgQuery = {
  name: 'xapi_activity_upsert',
  text: `INSERT INTO xapi.activities (tenant_id, id, definition, updated_at)
         VALUES (${TENANT_ID_EXPR}, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE
         SET definition = (
           SELECT COALESCE(jsonb_object_agg(
             k,
             CASE
               WHEN jsonb_typeof(COALESCE(old_v, 'null'::jsonb)) = 'object'
                AND jsonb_typeof(COALESCE(new_v, 'null'::jsonb)) = 'object'
               THEN COALESCE(old_v, '{}'::jsonb) || COALESCE(new_v, '{}'::jsonb)
               ELSE COALESCE(new_v, old_v)
             END
           ), '{}'::jsonb)
           FROM (
             SELECT
               COALESCE(o.key, n.key) AS k,
               o.value AS old_v,
               n.value AS new_v
             FROM jsonb_each(COALESCE(xapi.activities.definition, '{}'::jsonb)) o
             FULL OUTER JOIN jsonb_each(COALESCE(EXCLUDED.definition, '{}'::jsonb)) n ON o.key = n.key
           ) merged
         ),
             updated_at = NOW()`,
};

const AGENT_UPSERT: PgQuery = {
  name: 'xapi_agent_upsert',
  text: `INSERT INTO xapi.agents (tenant_id, ifi, person_data, updated_at)
         VALUES (${TENANT_ID_EXPR}, $1, $2, NOW())
         ON CONFLICT (ifi) DO UPDATE
         SET person_data = $3,
             updated_at = NOW()`,
};

const AGENT_LOCK: PgQuery = {
  name: 'xapi_agent_lock',
  text: `SELECT person_data FROM xapi.agents WHERE ifi = $1 FOR UPDATE`,
};

export interface PersonData {
  name?: string[];
  mbox?: string[];
  mbox_sha1sum?: string[];
  openid?: string[];
  account?: Array<{ homePage: string; name: string }>;
}

export function agentToPersonData(agent: Agent): PersonData {
  const data: PersonData = {};
  if (agent.name) data.name = [agent.name];
  if (agent.mbox) data.mbox = [agent.mbox];
  if (agent.mbox_sha1sum) data.mbox_sha1sum = [agent.mbox_sha1sum];
  if (agent.openid) data.openid = [agent.openid];
  if (agent.account) data.account = [agent.account];
  return data;
}

export function mergePersonData(existing: PersonData, incoming: PersonData): PersonData {
  const merged: PersonData = {};

  for (const key of ['name', 'mbox', 'mbox_sha1sum', 'openid'] as const) {
    const a = existing[key] ?? [];
    const b = incoming[key] ?? [];
    const union = [...new Set([...a, ...b])];
    if (union.length > 0) merged[key] = union;
  }

  const existingAccounts = existing.account ?? [];
  const incomingAccounts = incoming.account ?? [];
  const seen = new Set(existingAccounts.map((a) => `${a.homePage}|${a.name}`));
  const mergedAccounts = [...existingAccounts];
  for (const acc of incomingAccounts) {
    const k = `${acc.homePage}|${acc.name}`;
    if (!seen.has(k)) {
      seen.add(k);
      mergedAccounts.push(acc);
    }
  }
  if (mergedAccounts.length > 0) merged.account = mergedAccounts;

  return merged;
}

export function extractAllActivities(stmt: Statement): Activity[] {
  const seen = new Set<string>();
  const activities: Activity[] = [];

  const push = (a: Activity) => {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      activities.push(a);
    }
  };

  const pushFromContextActivities = (ca?: ContextActivities) => {
    if (!ca) return;
    for (const list of [ca.parent, ca.grouping, ca.category, ca.other]) {
      if (list) for (const a of list) push(a);
    }
  };

  const extractActivity = (s: Statement): Activity | null => {
    if (!s.object || !('id' in s.object)) return null;
    const objType = 'objectType' in s.object ? s.object.objectType : undefined;
    if (objType && objType !== 'Activity') return null;
    return s.object as Activity;
  };

  const topActivity = extractActivity(stmt);
  if (topActivity) push(topActivity);

  pushFromContextActivities(stmt.context?.contextActivities);

  if (stmt.object && 'objectType' in stmt.object && stmt.object.objectType === 'SubStatement') {
    const sub = stmt.object as import('./types.js').SubStatement;
    if (sub.object && 'id' in sub.object) {
      const subObjType = 'objectType' in sub.object ? sub.object.objectType : undefined;
      if (!subObjType || subObjType === 'Activity') push(sub.object as Activity);
    }
    pushFromContextActivities(sub.context?.contextActivities);
  }

  return activities;
}

export async function upsertActivityOnClient(q: Queryable, activityId: string, definition: ActivityDefinition | undefined): Promise<void> {
  await q.query({
    ...ACTIVITY_UPSERT,
    values: [activityId, definition ? JSON.stringify(definition) : null],
  });
}

export async function upsertAgentOnClient(q: Queryable, agent: Agent, ifi: string): Promise<void> {
  const incoming = agentToPersonData(agent);

  const { rows } = await q.query<{ person_data: PersonData }>({
    ...AGENT_LOCK,
    values: [ifi],
  });

  const existingRow = rows[0];
  if (existingRow) {
    const merged = mergePersonData(existingRow.person_data, incoming);
    await q.query({ ...AGENT_UPSERT, values: [ifi, JSON.stringify(merged), JSON.stringify(merged)] });
  } else {
    await q.query({ ...AGENT_UPSERT, values: [ifi, JSON.stringify(incoming), JSON.stringify(incoming)] });
  }
}

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

export interface StoredDocumentRow {
  content: Buffer;
  content_type: string;
  etag: string;
  updated_at: Date;
}

import type { StoredDocument } from './types.js';

export function toStoredDocument(row: StoredDocumentRow): StoredDocument {
  return { content: row.content, contentType: row.content_type, etag: row.etag, updatedAt: row.updated_at };
}

export { computeEtag } from './agent-ifi.js';
