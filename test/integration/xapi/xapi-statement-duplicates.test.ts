/**
 * Integration Tests: xAPI Statement Duplicate Detection
 * Tests that the LRS handles duplicate statement IDs correctly per xAPI 1.0.3 spec.
 *
 * Content-based conflict detection (409 for different content with same ID)
 * is not yet implemented in the LRS — those tests are marked .todo().
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatement(id: string): Record<string, unknown> {
  return {
    id,
    actor: { mbox: 'mailto:test@example.com' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    object: { id: 'http://example.com/activities/1' },
    timestamp: '2024-01-15T12:00:00.000Z',
  };
}

async function postStatement(apiUrl: string, auth: string, stmt: unknown) {
  return fetch(`${apiUrl}/xapi/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}`, ...V },
    body: JSON.stringify(stmt),
  });
}

async function putStatement(apiUrl: string, auth: string, statementId: string, stmt: unknown) {
  return fetch(`${apiUrl}/xapi/statements?statementId=${statementId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}`, ...V },
    body: JSON.stringify(stmt),
  });
}

// =========================================================================
// POST duplicate detection (idempotency)
// =========================================================================

describe('POST duplicate statement detection', () => {
  test('POST same statement twice is idempotent (200)', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const stmt = makeStatement(id);

    const resp1 = await postStatement(server.apiUrl, basicAuth, stmt);
    expect(resp1.status).toBe(200);

    const resp2 = await postStatement(server.apiUrl, basicAuth, stmt);
    expect(resp2.status).toBe(200);
    const ids = await resp2.json();
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(id);
  });

  test('POST different statement with same ID returns 409', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const stmt1 = makeStatement(id);
    const resp1 = await postStatement(server.apiUrl, basicAuth, stmt1);
    expect(resp1.status).toBe(200);

    // Different verb -> different content
    const stmt2 = {
      ...makeStatement(id),
      verb: { id: 'http://example.com/verbs/other', display: { 'en-US': 'other' } },
    };
    const resp2 = await postStatement(server.apiUrl, basicAuth, stmt2);
    expect(resp2.status).toBe(409);
  });
});

// =========================================================================
// PUT duplicate detection (idempotency)
// =========================================================================

describe('PUT duplicate statement detection', () => {
  test('PUT same statement twice is idempotent (204)', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const stmt = makeStatement(id);

    const resp1 = await putStatement(server.apiUrl, basicAuth, id, stmt);
    expect(resp1.status).toBe(204);

    const resp2 = await putStatement(server.apiUrl, basicAuth, id, stmt);
    expect(resp2.status).toBe(204);
  });

  test('PUT different statement with same ID returns 409', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const stmt1 = makeStatement(id);
    const resp1 = await putStatement(server.apiUrl, basicAuth, id, stmt1);
    expect(resp1.status).toBe(204);

    // Different verb -> different content
    const stmt2 = {
      ...makeStatement(id),
      verb: { id: 'http://example.com/verbs/other', display: { 'en-US': 'other' } },
    };
    const resp2 = await putStatement(server.apiUrl, basicAuth, id, stmt2);
    expect(resp2.status).toBe(409);
  });
});
