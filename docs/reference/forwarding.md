# Statement Forwarding

## Overview

Statement forwarding enables real-time replication of xAPI statements from this LRS to an upstream LRS. Use cases include:

- **LRS-to-LRS sync**: Mirror statements to a central LRS for aggregated reporting
- **Data replication**: Maintain a backup or read replica
- **Centralized reporting**: Forward from departmental LRS instances to a master LRS

Each tenant can have one forwarding target. Statements are forwarded as they arrive (live-tail) and any gaps are automatically recovered on server restart (catch-up from watermark).

## Configuration

Forwarding targets are managed via the admin UI at `/admin/forwarding`.

| Field | Description |
|-------|-------------|
| **Tenant** | The tenant whose statements will be forwarded |
| **Target URL** | The upstream LRS statements endpoint (e.g., `https://upstream.example.com/xapi/statements`) |
| **Authorization Header** | The full `Authorization` header value to include in forwarded requests (e.g., `Basic dXNlcjpwYXNz`) |
| **Enabled** | Whether forwarding is active for this tenant |

The admin UI also displays status information:

- **Last Forwarded**: Timestamp of the most recently forwarded statement
- **Status**: `Healthy` (no errors), `Error (N)` (N consecutive failures), or `Disabled`

## Behavior

### Two-Phase Model

1. **Catch-up phase** (on startup or target reload): Queries all un-voided statements stored after the last watermark, in `stored` order. Sends them in batches of 200 to the target. Updates the watermark after each successful batch.

2. **Live-tail phase**: Subscribes to PostgreSQL `NOTIFY` events on the `xapi_statements_new` channel. When a new statement is inserted, it is buffered for 500ms (batching window), then the full statement JSON is fetched and forwarded.

### Statement Preparation

Before forwarding, statements are prepared per xAPI spec:

- **Stripped**: `stored` (xAPI 2.4.8 — receiving LRS sets its own) and `authority` (xAPI 2.4.9 — receiving LRS sets its own based on forwarding credentials)
- **Preserved**: `id` (for deduplication at the receiver), `timestamp`, `version`, and all other fields

### Voided Statements

- Voiding statements (verb = `http://adlnet.gov/expapi/verbs/voided`) **are** forwarded (they are not themselves voided)
- Statements that have been voided by another statement are **not** forwarded during catch-up

## Retry & Error Handling

When a forwarding POST fails (HTTP error or network error):

1. **Exponential backoff**: Retries at 1s, 2s, 4s, 8s, 16s intervals (5 attempts max)
2. **On success**: Watermark is updated, error count is cleared
3. **On max retries exhausted**: Error is recorded in the database (`last_error`, `error_count` incremented)
4. **Error visibility**: Errors are shown in the admin UI with count and message
5. **Automatic recovery**: On the next incoming statement, forwarding is re-attempted. On server restart, catch-up from watermark covers any gap.

## xAPI Spec Compliance

| Aspect | Behavior | Spec Reference |
|--------|----------|----------------|
| Statement `id` | Preserved — receiver deduplicates by `id` | xAPI 2.4.1 |
| `timestamp` | Preserved | xAPI 2.4.7 |
| `stored` | Stripped — receiver sets its own | xAPI 2.4.8 |
| `authority` | Stripped — receiver sets based on credentials | xAPI 2.4.9 |
| `version` | Preserved | xAPI 2.4.10 |
| Deduplication | Safe to re-forward on restart edge cases | xAPI 2.3 |
| Content-Type | `application/json` | xAPI 7.2 |
| Version header | `X-Experience-API-Version: 1.0.3` | xAPI 6.2 |

## Limitations

- **JSON only**: Multipart/mixed attachments are not forwarded. Only the statement JSON is sent.
- **One target per tenant**: Each tenant can have at most one forwarding destination.
- **In-process retry**: Retry state is not persisted across restarts. However, the watermark-based catch-up on restart covers any statements that failed to forward before the process exited.
- **No filtering**: All non-voided statements for a tenant are forwarded. Statement-level filtering is not supported.
