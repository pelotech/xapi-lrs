/**
 * Server-Sent Events payload types for the LRS → API statement stream.
 *
 * The LRS fires pg_notify on each INSERT into xapi_statement. The SSE producer
 * bridges these notifications to an HTTP event stream that the API's SSE consumer
 * subscribes to for async CMI5 registration processing.
 *
 * The LRS is standalone and has no concept of tenants or statement source. The
 * API consumer resolves tenant context from the registration or AU IRI.
 */

export interface StatementStoredEvent {
  /** Monotonically increasing sequence number (bigserial on xapi.statements). */
  seq: string;
  /** xAPI statement UUID. */
  id: string;
  /** CMI5 registration UUID, if present on the statement. */
  registrationId: string | null;
  /** CMI5 session UUID, if the statement was issued with session-scoped auth. */
  sessionId: string | null;
  /** Verb IRI (for fast filtering without fetching the full statement). */
  verbIri: string;
  /** Full xAPI statement JSON, loaded by the SSE producer from DB. */
  statement: unknown;
}
