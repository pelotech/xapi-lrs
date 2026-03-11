/**
 * Shared logic for building SSE statement events from pg_notify payloads.
 * Used by both the xAPI /stream endpoint and the admin /stream/events endpoint.
 */

import type { Pool } from 'pg';
import type { LrsMetrics } from '../metrics.ts';
import type { StatementStoredEvent } from '../xapi-types/index.ts';
import { withClient } from '../db.ts';
import { getStatementById } from '../repositories/statements.ts';

export const XAPI_NOTIFY_CHANNEL = 'xapi_statement_stored';
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Parse a pg_notify payload, fetch the full statement, and return a
 * StatementStoredEvent ready for SSE serialization. Returns null if
 * the statement can't be found.
 */
export async function buildStatementEvent(
  pool: Pool,
  metrics: LrsMetrics,
  payload: string,
): Promise<StatementStoredEvent | null> {
  const data = JSON.parse(payload) as Record<string, unknown>;

  const row = await withClient(pool, metrics, (client) =>
    getStatementById(client, String(data.statement_id ?? data.id)),
  );

  if (!row) return null;

  const stmtContext = (row.payload.context ?? {}) as Record<string, unknown>;
  const extensions = (stmtContext.extensions ?? {}) as Record<string, unknown>;

  return {
    seq: String(data.seq ?? ''),
    id: row.statement_id,
    registrationId: (data.registration_id as string) ?? (stmtContext.registration as string) ?? null,
    sessionId: (data.session_id as string) ?? (extensions['https://w3id.org/xapi/cmi5/context/extensions/sessionid'] as string) ?? null,
    verbIri: String(data.verb_iri ?? '') || ((row.payload.verb as Record<string, unknown>)?.id as string ?? ''),
    statement: row.payload,
  };
}
