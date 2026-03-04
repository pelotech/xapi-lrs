import type pg from 'pg';
import type { Agent, StoredDocument } from './types.js';
import { agentToIfi, computeEtag } from './agent-ifi.js';
import { HttpError } from '../../core/errors.js';
import type { Queryable, StoredDocumentRow } from './pg-xapi.shared.js';
import { toStoredDocument } from './pg-xapi.shared.js';

type PgQuery = Omit<pg.QueryConfig, 'values'>;

const TENANT_ID_EXPR = `current_setting('request.tenant.id')::UUID`;

function validateMergeContentTypes(incomingContentType: string, existingContentType?: string): void {
  if (!incomingContentType.startsWith('application/json')) {
    throw new HttpError(400, 'BAD_REQUEST', 'Document merge requires Content-Type application/json on the request');
  }
  if (existingContentType !== undefined && !existingContentType.startsWith('application/json')) {
    throw new HttpError(400, 'BAD_REQUEST', 'Document merge requires the existing document to be application/json');
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_GET: PgQuery = {
  name: 'xapi_state_get',
  text: `SELECT content, content_type, etag, updated_at FROM xapi.documents
         WHERE resource = 'state' AND activity_id = $1 AND agent_ifi = $2 AND document_id = $3
         AND registration = $4`,
};

const STATE_LIST: PgQuery = {
  name: 'xapi_state_list',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'state' AND activity_id = $1 AND agent_ifi = $2
         AND registration = $3
         ORDER BY updated_at`,
};

const STATE_LIST_SINCE: PgQuery = {
  name: 'xapi_state_list_since',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'state' AND activity_id = $1 AND agent_ifi = $2
         AND registration = $3
         AND updated_at > $4
         ORDER BY updated_at`,
};

const STATE_UPSERT: PgQuery = {
  name: 'xapi_state_upsert',
  text: `INSERT INTO xapi.documents (tenant_id, resource, activity_id, agent_ifi, registration, document_id, content, content_type, etag, updated_at)
         VALUES (${TENANT_ID_EXPR}, 'state', $1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (resource, activity_id, agent_ifi, registration, document_id)
         DO UPDATE SET content = $5, content_type = $6, etag = $7, updated_at = NOW()`,
};

const STATE_DELETE: PgQuery = {
  name: 'xapi_state_delete',
  text: `DELETE FROM xapi.documents
         WHERE resource = 'state' AND activity_id = $1 AND agent_ifi = $2 AND document_id = $3
         AND registration = $4`,
};

const STATE_DELETE_ALL: PgQuery = {
  name: 'xapi_state_delete_all',
  text: `DELETE FROM xapi.documents
         WHERE resource = 'state' AND activity_id = $1 AND agent_ifi = $2
         AND registration = $3`,
};

export async function getStateDocument(
  q: Queryable, activityId: string, agent: Agent, stateId: string, registration?: string,
): Promise<StoredDocument | null> {
  const { rows } = await q.query<StoredDocumentRow>({ ...STATE_GET, values: [activityId, agentToIfi(agent), stateId, registration ?? ''] });
  const row = rows[0];
  return row ? toStoredDocument(row) : null;
}

export async function getStateIds(
  q: Queryable, activityId: string, agent: Agent, registration?: string, since?: Date,
): Promise<readonly string[]> {
  const ifi = agentToIfi(agent);
  const query = since ? STATE_LIST_SINCE : STATE_LIST;
  const values = since
    ? [activityId, ifi, registration ?? '', since]
    : [activityId, ifi, registration ?? ''];
  const { rows } = await q.query<{ document_id: string }>({ ...query, values });
  return rows.map((r) => r.document_id);
}

export async function setStateDocument(
  q: Queryable, activityId: string, agent: Agent, stateId: string, content: Buffer, contentType: string, registration?: string,
): Promise<string> {
  const etag = computeEtag(content);
  await q.query({ ...STATE_UPSERT, values: [activityId, agentToIfi(agent), registration ?? '', stateId, content, contentType, etag] });
  return etag;
}

export async function mergeStateDocument(
  q: Queryable, activityId: string, agent: Agent, stateId: string, content: Buffer, contentType: string, registration?: string,
): Promise<string> {
  if (contentType === 'application/json') {
    try {
      JSON.parse(content.toString('utf8'));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    }
  }
  const existing = await getStateDocument(q, activityId, agent, stateId, registration);
  validateMergeContentTypes(contentType, existing?.contentType);
  if (existing) {
    const existingObj = JSON.parse(existing.content.toString('utf8')) as Record<string, unknown>;
    const incomingObj = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    const merged = Buffer.from(JSON.stringify({ ...existingObj, ...incomingObj }));
    return setStateDocument(q, activityId, agent, stateId, merged, 'application/json', registration);
  }
  return setStateDocument(q, activityId, agent, stateId, content, contentType, registration);
}

export async function deleteStateDocument(
  q: Queryable, activityId: string, agent: Agent, stateId: string, registration?: string,
): Promise<void> {
  await q.query({ ...STATE_DELETE, values: [activityId, agentToIfi(agent), stateId, registration ?? ''] });
}

export async function deleteStateDocuments(
  q: Queryable, activityId: string, agent: Agent, registration?: string,
): Promise<void> {
  await q.query({ ...STATE_DELETE_ALL, values: [activityId, agentToIfi(agent), registration ?? ''] });
}

// ---------------------------------------------------------------------------
// Activity Profile
// ---------------------------------------------------------------------------

const AP_GET: PgQuery = {
  name: 'xapi_ap_get',
  text: `SELECT content, content_type, etag, updated_at FROM xapi.documents
         WHERE resource = 'activity_profile' AND activity_id = $1 AND document_id = $2`,
};

const AP_LIST: PgQuery = {
  name: 'xapi_ap_list',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'activity_profile' AND activity_id = $1
         ORDER BY updated_at`,
};

const AP_LIST_SINCE: PgQuery = {
  name: 'xapi_ap_list_since',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'activity_profile' AND activity_id = $1 AND updated_at > $2
         ORDER BY updated_at`,
};

const AP_UPSERT: PgQuery = {
  name: 'xapi_ap_upsert',
  text: `INSERT INTO xapi.documents (tenant_id, resource, activity_id, agent_ifi, registration, document_id, content, content_type, etag, updated_at)
         VALUES (${TENANT_ID_EXPR}, 'activity_profile', $1, '', '', $2, $3, $4, $5, NOW())
         ON CONFLICT (resource, activity_id, agent_ifi, registration, document_id)
         DO UPDATE SET content = $3, content_type = $4, etag = $5, updated_at = NOW()`,
};

const AP_DELETE: PgQuery = {
  name: 'xapi_ap_delete',
  text: `DELETE FROM xapi.documents WHERE resource = 'activity_profile' AND activity_id = $1 AND document_id = $2`,
};

export async function getActivityProfileDocument(q: Queryable, activityId: string, profileId: string): Promise<StoredDocument | null> {
  const { rows } = await q.query<StoredDocumentRow>({ ...AP_GET, values: [activityId, profileId] });
  const row = rows[0];
  return row ? toStoredDocument(row) : null;
}

export async function getActivityProfileIds(q: Queryable, activityId: string, since?: Date): Promise<readonly string[]> {
  const query = since ? AP_LIST_SINCE : AP_LIST;
  const values = since ? [activityId, since] : [activityId];
  const { rows } = await q.query<{ document_id: string }>({ ...query, values });
  return rows.map((r) => r.document_id);
}

export async function setActivityProfileDocument(q: Queryable, activityId: string, profileId: string, content: Buffer, contentType: string): Promise<string> {
  const etag = computeEtag(content);
  await q.query({ ...AP_UPSERT, values: [activityId, profileId, content, contentType, etag] });
  return etag;
}

export async function mergeActivityProfileDocument(q: Queryable, activityId: string, profileId: string, content: Buffer, contentType: string): Promise<string> {
  if (contentType === 'application/json') {
    try {
      JSON.parse(content.toString('utf8'));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    }
  }
  const existing = await getActivityProfileDocument(q, activityId, profileId);
  validateMergeContentTypes(contentType, existing?.contentType);
  if (existing) {
    const existingObj = JSON.parse(existing.content.toString('utf8')) as Record<string, unknown>;
    const incomingObj = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    const merged = Buffer.from(JSON.stringify({ ...existingObj, ...incomingObj }));
    return setActivityProfileDocument(q, activityId, profileId, merged, 'application/json');
  }
  return setActivityProfileDocument(q, activityId, profileId, content, contentType);
}

export async function deleteActivityProfileDocument(q: Queryable, activityId: string, profileId: string): Promise<void> {
  await q.query({ ...AP_DELETE, values: [activityId, profileId] });
}

// ---------------------------------------------------------------------------
// Agent Profile
// ---------------------------------------------------------------------------

const AGP_GET: PgQuery = {
  name: 'xapi_agp_get',
  text: `SELECT content, content_type, etag, updated_at FROM xapi.documents
         WHERE resource = 'agent_profile' AND agent_ifi = $1 AND document_id = $2`,
};

const AGP_LIST: PgQuery = {
  name: 'xapi_agp_list',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'agent_profile' AND agent_ifi = $1
         ORDER BY updated_at`,
};

const AGP_LIST_SINCE: PgQuery = {
  name: 'xapi_agp_list_since',
  text: `SELECT document_id FROM xapi.documents
         WHERE resource = 'agent_profile' AND agent_ifi = $1 AND updated_at > $2
         ORDER BY updated_at`,
};

const AGP_UPSERT: PgQuery = {
  name: 'xapi_agp_upsert',
  text: `INSERT INTO xapi.documents (tenant_id, resource, activity_id, agent_ifi, registration, document_id, content, content_type, etag, updated_at)
         VALUES (${TENANT_ID_EXPR}, 'agent_profile', '', $1, '', $2, $3, $4, $5, NOW())
         ON CONFLICT (resource, activity_id, agent_ifi, registration, document_id)
         DO UPDATE SET content = $3, content_type = $4, etag = $5, updated_at = NOW()`,
};

const AGP_DELETE: PgQuery = {
  name: 'xapi_agp_delete',
  text: `DELETE FROM xapi.documents WHERE resource = 'agent_profile' AND agent_ifi = $1 AND document_id = $2`,
};

export async function getAgentProfileDocument(q: Queryable, agent: Agent, profileId: string): Promise<StoredDocument | null> {
  const { rows } = await q.query<StoredDocumentRow>({ ...AGP_GET, values: [agentToIfi(agent), profileId] });
  const row = rows[0];
  return row ? toStoredDocument(row) : null;
}

export async function getAgentProfileIds(q: Queryable, agent: Agent, since?: Date): Promise<readonly string[]> {
  const ifi = agentToIfi(agent);
  const query = since ? AGP_LIST_SINCE : AGP_LIST;
  const values = since ? [ifi, since] : [ifi];
  const { rows } = await q.query<{ document_id: string }>({ ...query, values });
  return rows.map((r) => r.document_id);
}

export async function setAgentProfileDocument(q: Queryable, agent: Agent, profileId: string, content: Buffer, contentType: string): Promise<string> {
  const etag = computeEtag(content);
  await q.query({ ...AGP_UPSERT, values: [agentToIfi(agent), profileId, content, contentType, etag] });
  return etag;
}

export async function mergeAgentProfileDocument(q: Queryable, agent: Agent, profileId: string, content: Buffer, contentType: string): Promise<string> {
  if (contentType === 'application/json') {
    try {
      JSON.parse(content.toString('utf8'));
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    }
  }
  const existing = await getAgentProfileDocument(q, agent, profileId);
  validateMergeContentTypes(contentType, existing?.contentType);
  if (existing) {
    const existingObj = JSON.parse(existing.content.toString('utf8')) as Record<string, unknown>;
    const incomingObj = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    const merged = Buffer.from(JSON.stringify({ ...existingObj, ...incomingObj }));
    return setAgentProfileDocument(q, agent, profileId, merged, 'application/json');
  }
  return setAgentProfileDocument(q, agent, profileId, content, contentType);
}

export async function deleteAgentProfileDocument(q: Queryable, agent: Agent, profileId: string): Promise<void> {
  await q.query({ ...AGP_DELETE, values: [agentToIfi(agent), profileId] });
}
