/**
 * SSE streaming endpoint for xAPI statements.
 *
 * GET /xapi/statements/stream
 *
 * Two phases:
 *  1. Catch-up — replays existing statements matching filters (cursor-based)
 *  2. Live tail — subscribes to PG LISTEN/NOTIFY for new inserts
 *
 * Manual Express route (not TSOA) because SSE's long-lived connection and
 * streaming writes don't fit TSOA's request/response model.
 */

import type { Request, Response } from 'express';
import type { AppContext, ScopedClient } from '../../core/context.js';
import { asUserOidc, asUserXapiBasicAuth } from '../../core/context.js';
import { expressAuthentication } from '../../core/authentication.js';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';
import { agentToIfi, actorToIfi } from './agent-ifi.js';
import { ifiToJsonbContains } from './pg-xapi.statements.js';
import { formatStatement } from './statement-format.js';
import type { Agent, Statement, StatementFormat } from './types.js';
import { HttpError } from '../../core/errors.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const CATCHUP_BATCH_SIZE = 100;

interface StreamFilters {
  verb?: string;
  activity?: string;
  agent?: Agent;
  agentIfi?: string;
  registration?: string;
  related_activities?: boolean;
  related_agents?: boolean;
  since?: string;
  format: StatementFormat;
}

interface NotifyPayload {
  tenant_id: string;
  id: string;
  verb_id: string;
  actor_ifi: string | null;
  activity_id: string | null;
  stored: string;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sseWrite(res: Response, event: string, data: string, id?: string): boolean {
  let frame = `event: ${event}\ndata: ${data}\n`;
  if (id) frame += `id: ${id}\n`;
  frame += '\n';
  return res.write(frame);
}

// ---------------------------------------------------------------------------
// Auth helpers — derive asUser + tenantId from the request
// ---------------------------------------------------------------------------

interface AuthResult {
  asUser: <T>(cb: (client: ScopedClient) => Promise<T>) => Promise<T>;
  tenantId: string | undefined;
  readMineOnly: boolean;
  credentialIfi?: string;
}

async function authenticateRequest(req: Request): Promise<AuthResult> {
  const ctx = req.app.locals['ctx'] as AppContext;

  // Try xapi_basic first, then jwt (same order as TSOA routes)
  let user: unknown;
  let securityName: string;
  try {
    user = await expressAuthentication(req, 'xapi_basic');
    securityName = 'xapi_basic';
  } catch {
    user = await expressAuthentication(req, 'jwt');
    securityName = 'jwt';
  }

  const reqRaw = req as unknown as Record<string, unknown>;
  const readMineOnly = reqRaw.xapiReadMineOnly as boolean | undefined ?? false;
  const credentialIfi = reqRaw.xapiCredentialIfi as string | undefined;

  let tenantId: string | undefined;
  let asUser: AuthResult['asUser'];

  if (securityName === 'xapi_basic') {
    const u = user as { key: string; secret: string; tenantId: string };
    tenantId = u.tenantId;
    asUser = <T>(cb: (client: ScopedClient) => Promise<T>) =>
      asUserXapiBasicAuth(ctx.pool, u.key, u.secret, cb);
  } else {
    const u = user as { iss: string; aud: string; sub: string; tenantId?: string };
    tenantId = u.tenantId;
    asUser = <T>(cb: (client: ScopedClient) => Promise<T>) =>
      asUserOidc(ctx.pool, u.iss, u.aud, u.sub, cb);
  }

  return { asUser, tenantId, readMineOnly, credentialIfi };
}

// ---------------------------------------------------------------------------
// Catch-up phase — stream existing statements from DB
// ---------------------------------------------------------------------------

async function catchUp(
  client: ScopedClient,
  filters: StreamFilters,
  readMineOnly: boolean,
  credentialIfi: string | undefined,
  res: Response,
  acceptLanguage?: string,
): Promise<string | undefined> {
  let lastStored: string | undefined;
  let cursorStored: string | undefined;
  let cursorId: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { conditions, params, idx: startIdx } = buildFilterConditions(filters, readMineOnly, credentialIfi);
    let idx = startIdx;

    if (cursorStored && cursorId) {
      conditions.push(`(stored, id) > ($${String(idx++)}, $${String(idx++)})`);
      params.push(cursorStored, cursorId);
    }

    const sql = `SELECT raw, stored, id FROM xapi.statements
      WHERE ${conditions.join(' AND ')}
      ORDER BY stored ASC, id ASC
      LIMIT $${String(idx++)}`;
    params.push(CATCHUP_BATCH_SIZE);

    const { rows } = await client.query<{ raw: Statement; stored: string; id: string }>(sql, params);

    if (rows.length === 0) break;

    for (const row of rows) {
      const formatted = formatStatement(row.raw, filters.format, acceptLanguage);
      sseWrite(res, 'statement', JSON.stringify(formatted), row.stored);
      lastStored = row.stored;
      cursorStored = row.stored;
      cursorId = row.id;
    }

    if (rows.length < CATCHUP_BATCH_SIZE) break;
  }

  return lastStored;
}

// ---------------------------------------------------------------------------
// Filter condition builder (shared between catch-up & query)
// ---------------------------------------------------------------------------

function buildFilterConditions(
  filters: StreamFilters,
  readMineOnly: boolean,
  credentialIfi: string | undefined,
): { conditions: string[]; params: unknown[]; idx: number } {
  const conditions: string[] = ['voided = FALSE'];
  const params: unknown[] = [];
  let idx = 1;

  if (readMineOnly && credentialIfi) {
    conditions.push(`raw->'authority' @> $${String(idx++)}::jsonb`);
    params.push(ifiToJsonbContains(credentialIfi));
  }

  if (filters.verb) {
    conditions.push(`verb_id = $${String(idx++)}`);
    params.push(filters.verb);
  }

  if (filters.activity) {
    if (filters.related_activities) {
      const activityParam = `$${String(idx++)}`;
      params.push(filters.activity);
      const containsParam = `$${String(idx++)}`;
      params.push(JSON.stringify([{ id: filters.activity }]));
      conditions.push(`(${relatedActivitiesCondition(activityParam, containsParam)})`);
    } else {
      conditions.push(`activity_id = $${String(idx++)}`);
      params.push(filters.activity);
    }
  }

  if (filters.registration) {
    conditions.push(`registration = $${String(idx++)}`);
    params.push(filters.registration);
  }

  if (filters.agentIfi) {
    if (filters.related_agents) {
      const ifiParam = `$${String(idx++)}`;
      params.push(filters.agentIfi);
      const containsParam = `$${String(idx++)}`;
      params.push(ifiToJsonbContains(filters.agentIfi));
      conditions.push(`(${relatedAgentsCondition(ifiParam, containsParam)})`);
    } else {
      conditions.push(`actor_ifi = $${String(idx++)}`);
      params.push(filters.agentIfi);
    }
  }

  if (filters.since) {
    conditions.push(`stored > $${String(idx++)}`);
    params.push(filters.since);
  }

  return { conditions, params, idx };
}

// Duplicated from pg-xapi.statements.ts — these are SQL fragment builders,
// not exported from the barrel. Keep in sync.
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

// ---------------------------------------------------------------------------
// Live-tail notify filter (in-memory, no DB query unless match)
// ---------------------------------------------------------------------------

function notifyMatchesFilters(payload: NotifyPayload, filters: StreamFilters): boolean {
  if (filters.verb && payload.verb_id !== filters.verb) return false;
  if (filters.activity && !filters.related_activities && payload.activity_id !== filters.activity) return false;
  if (filters.agentIfi && !filters.related_agents && payload.actor_ifi !== filters.agentIfi) return false;
  // For related_activities/related_agents, we can't fully filter from the compact payload,
  // so we let it through and the full statement fetch + format will handle it.
  // Similarly for registration — not in the compact payload.
  return true;
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

export function statementsStreamHandler(req: Request, res: Response): void {
  // Run through version middleware first
  xapiVersionMiddleware(req, res, (err?: unknown) => {
    if (err) return;
    handleStream(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          res.status(status).json({
            error: { status, code: 'AUTH_ERROR', message: error.message },
          });
        } else if (error instanceof HttpError) {
          res.status(error.status).json({
            error: { status: error.status, code: error.code, message: error.message },
          });
        } else {
          req.log?.error({ err: error }, 'SSE stream error');
          res.status(500).json({
            error: { status: 500, code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
          });
        }
      }
    });
  });
}

async function handleStream(req: Request, res: Response): Promise<void> {
  const ctx = req.app.locals['ctx'] as AppContext;

  // 1. Authenticate
  const auth = await authenticateRequest(req);

  // 2. Parse filters from query params
  const filters = parseFilters(req);

  // Support SSE reconnect: Last-Event-ID takes priority over since
  const lastEventId = req.get('Last-Event-ID');
  if (lastEventId) {
    filters.since = filters.since && filters.since > lastEventId ? filters.since : lastEventId;
  }

  const acceptLanguage = req.get('Accept-Language');

  // 3. Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Experience-API-Version': '1.0.3',
  });
  res.flushHeaders();

  // 4. Catch-up phase — stream existing statements
  const lastStored = await auth.asUser(async (client) => {
    return catchUp(client, filters, auth.readMineOnly, auth.credentialIfi, res, acceptLanguage);
  });

  // 5. Send caught-up event
  sseWrite(res, 'caught-up', JSON.stringify({ stored: lastStored ?? new Date().toISOString() }));

  // 6. Live tail — subscribe to PG NOTIFY
  const notifyHandler = async (payloadStr: string) => {
    try {
      const payload = JSON.parse(payloadStr) as NotifyPayload;

      // Filter by tenant (RLS equivalent)
      if (auth.tenantId && payload.tenant_id !== auth.tenantId) return;

      // Apply compact filters
      if (!notifyMatchesFilters(payload, filters)) return;

      // Fetch full statement within RLS-scoped transaction
      const stmt = await auth.asUser(async (client) => {
        const { rows } = await client.query<{ raw: Statement }>(
          'SELECT raw FROM xapi.statements WHERE id = $1',
          [payload.id],
        );
        return rows[0]?.raw ?? null;
      });

      if (!stmt) return;

      const formatted = formatStatement(stmt, filters.format, acceptLanguage);
      sseWrite(res, 'statement', JSON.stringify(formatted), payload.stored);
    } catch (err) {
      req.log?.error({ err }, 'Error processing notify payload');
    }
  };

  ctx.notifyListener.on('xapi_statements_new', notifyHandler);

  // 7. Heartbeat
  const heartbeatTimer = setInterval(() => {
    sseWrite(res, 'heartbeat', '{}');
  }, HEARTBEAT_INTERVAL_MS);

  // 8. Cleanup on client disconnect
  req.on('close', () => {
    ctx.notifyListener.off('xapi_statements_new', notifyHandler);
    clearInterval(heartbeatTimer);
    req.log?.info('SSE stream client disconnected');
  });
}

// ---------------------------------------------------------------------------
// Query param parsing
// ---------------------------------------------------------------------------

function parseFilters(req: Request): StreamFilters {
  const query = req.query;
  const format = (query.format as string | undefined) ?? 'exact';
  if (format !== 'exact' && format !== 'ids' && format !== 'canonical') {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid format parameter; must be "exact", "ids", or "canonical"');
  }

  let parsedAgent: Agent | undefined;
  let agentIfi: string | undefined;
  if (query.agent) {
    let raw: unknown;
    try {
      raw = JSON.parse(query.agent as string);
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON in agent query parameter');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new HttpError(400, 'BAD_REQUEST', 'Agent must be a JSON object');
    }
    parsedAgent = raw as Agent;
    agentIfi = agentToIfi(parsedAgent) ?? actorToIfi(parsedAgent) ?? undefined;
  }

  return {
    verb: query.verb as string | undefined,
    activity: query.activity as string | undefined,
    agent: parsedAgent,
    agentIfi,
    registration: query.registration as string | undefined,
    related_activities: query.related_activities === 'true',
    related_agents: query.related_agents === 'true',
    since: query.since as string | undefined,
    format: format as StatementFormat,
  };
}
