/**
 * Integration tests: reject statement batches with duplicate ids (design 2f).
 *
 * Empirically confirmed (before this fix): POSTing two identical statements
 * sharing an `id` in one batch returned 200 with `[id, id]` (no within-batch
 * duplicate-id check — the second insert is absorbed by ON CONFLICT DO
 * NOTHING and statementsMatch found them identical). The v2_0 ADL
 * conformance battery (test/v2_0/4.1.6.1-Statement-Resource.js:240-260)
 * expects 400 for a same-id batch.
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

function makeStatement(id: string, verbId: string, activityId: string) {
  return {
    id,
    actor: { mbox: 'mailto:batch-dup@example.com' },
    verb: { id: verbId, display: { 'en-US': 'x' } },
    object: { id: activityId },
  };
}

describe('POST /xapi/statements rejects duplicate ids within a batch', () => {
  test('two identical statements sharing an id -> 400', async ({ server, basicAuth }) => {
    const headers = { ...V, 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` };
    const id = randomUUID();
    const stmt = makeStatement(
      id,
      'http://example.com/verbs/batch-dup-identical',
      'http://example.com/activities/batch-dup-identical',
    );

    const res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify([stmt, stmt]),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();

    // No partial write: statement must not exist.
    const getRes = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(getRes.status).toBe(404);
  });

  test('two DIFFERENT statements sharing an id -> 400', async ({ server, basicAuth }) => {
    const headers = { ...V, 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` };
    const id = randomUUID();
    const stmtA = makeStatement(
      id,
      'http://example.com/verbs/batch-dup-diff-a',
      'http://example.com/activities/batch-dup-diff-a',
    );
    const stmtB = makeStatement(
      id,
      'http://example.com/verbs/batch-dup-diff-b',
      'http://example.com/activities/batch-dup-diff-b',
    );

    const res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify([stmtA, stmtB]),
    });
    expect(res.status).toBe(400);

    const getRes = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(getRes.status).toBe(404);
  });

  test('distinct-id batch still succeeds (no false positive)', async ({ server, basicAuth }) => {
    const headers = { ...V, 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` };
    const idA = randomUUID();
    const idB = randomUUID();
    const stmtA = makeStatement(
      idA,
      'http://example.com/verbs/batch-distinct-a',
      'http://example.com/activities/batch-distinct-a',
    );
    const stmtB = makeStatement(
      idB,
      'http://example.com/verbs/batch-distinct-b',
      'http://example.com/activities/batch-distinct-b',
    );

    const res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify([stmtA, stmtB]),
    });
    expect(res.status).toBe(200);
    const ids = (await res.json()) as string[];
    expect(ids.sort()).toEqual([idA, idB].sort());
  });
});
