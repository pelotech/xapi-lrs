import type pg from 'pg';
import type { Activity, ActivityDefinition, Agent, Person } from './types.js';
import { agentToIfi } from './agent-ifi.js';
import type { Queryable, PersonData } from './pg-xapi.shared.js';

type PgQuery = Omit<pg.QueryConfig, 'values'>;

const TENANT_ID_EXPR = `current_setting('request.tenant.id')::UUID`;

// ---------------------------------------------------------------------------
// Attachment metadata
// ---------------------------------------------------------------------------

const ATTACHMENT_META_UPSERT: PgQuery = {
  name: 'xapi_attachment_meta_upsert',
  text: `INSERT INTO xapi.attachments (tenant_id, sha2, content_type)
         VALUES (${TENANT_ID_EXPR}, $1, $2)
         ON CONFLICT (sha2) DO NOTHING`,
};

const ATTACHMENT_META_GET_BATCH = `SELECT sha2, content_type FROM xapi.attachments WHERE sha2 = ANY($1)`;

export interface AttachmentMetaRow {
  sha2: string;
  content_type: string;
}

export async function storeAttachmentMeta(q: Queryable, sha2: string, contentType: string): Promise<void> {
  await q.query({ ...ATTACHMENT_META_UPSERT, values: [sha2, contentType] });
}

export async function getAttachmentMetaBatch(q: Queryable, sha2s: readonly string[]): Promise<AttachmentMetaRow[]> {
  if (sha2s.length === 0) return [];
  const { rows } = await q.query<AttachmentMetaRow>(ATTACHMENT_META_GET_BATCH, [sha2s]);
  return rows;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const ACTIVITY_GET: PgQuery = {
  name: 'xapi_activity_get',
  text: `SELECT id, definition FROM xapi.activities WHERE id = $1`,
};

export async function getActivity(q: Queryable, activityId: string): Promise<Activity | null> {
  const { rows } = await q.query<{ id: string; definition: Activity['definition'] }>({ ...ACTIVITY_GET, values: [activityId] });
  const row = rows[0];
  if (!row) return null;
  return {
    objectType: 'Activity',
    id: row.id,
    ...(row.definition ? { definition: row.definition } : {}),
  };
}

export async function getActivitiesBatch(q: Queryable, ids: readonly string[]): Promise<Map<string, ActivityDefinition>> {
  const map = new Map<string, ActivityDefinition>();
  if (ids.length === 0) return map;
  const { rows } = await q.query<{ id: string; definition: ActivityDefinition | null }>(
    `SELECT id, definition FROM xapi.activities WHERE id = ANY($1)`,
    [ids],
  );
  for (const row of rows) {
    if (row.definition) map.set(row.id, row.definition);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const AGENT_GET: PgQuery = {
  name: 'xapi_agent_get',
  text: `SELECT person_data FROM xapi.agents WHERE ifi = $1`,
};

export async function getAgent(q: Queryable, agent: Agent): Promise<Person | null> {
  const { rows } = await q.query<{ person_data: PersonData }>({ ...AGENT_GET, values: [agentToIfi(agent)] });
  const row = rows[0];
  if (!row) return null;
  const d = row.person_data;
  return {
    objectType: 'Person',
    ...(d.name?.length ? { name: d.name } : {}),
    ...(d.mbox?.length ? { mbox: d.mbox } : {}),
    ...(d.mbox_sha1sum?.length ? { mbox_sha1sum: d.mbox_sha1sum } : {}),
    ...(d.openid?.length ? { openid: d.openid } : {}),
    ...(d.account?.length ? { account: d.account } : {}),
  };
}
