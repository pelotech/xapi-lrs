/**
 * Integration tests: State-resource ETag concurrency for xAPI 2.0 (design 2h).
 *
 * xAPI 2.0 requires the State resource to enforce concurrency: a PUT to an
 * EXISTING state document without an If-Match/If-None-Match precondition must
 * be rejected with 409. xAPI 1.0.3 explicitly excludes the State resource from
 * concurrency (test/v1_0_3/H.Communication3.1-Concurrency.js:36), so the same
 * headerless PUT stays 204. A first-time PUT of a NEW state document without a
 * precondition must also stay 204 (never a 400) under both versions.
 *
 * Mirrors the v2_0 ADL battery (test/v2_0/4.1.4-Concurrency.js:222-260).
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V20 = { 'X-Experience-API-Version': '2.0.0' } as const;
const V103 = { 'X-Experience-API-Version': '1.0.3' } as const;

const AGENT = JSON.stringify({ mbox: 'mailto:state-concurrency@example.com' });

function stateUrl(base: string, activityId: string, stateId: string): string {
  const params = new URLSearchParams({ activityId, agent: AGENT, stateId });
  return `${base}/xapi/activities/state?${params.toString()}`;
}

describe('State resource ETag concurrency', () => {
  test('2.0: new-doc PUT (no precondition) -> 204; re-PUT existing (no precondition) -> 409, doc unchanged', async ({
    server,
    basicAuth,
  }) => {
    const activityId = `http://example.com/activities/state-conc-${randomUUID()}`;
    const stateId = 'state-1';
    const url = stateUrl(server.apiUrl, activityId, stateId);
    const authHeaders = { Authorization: `Basic ${basicAuth}` };

    // 1. PUT a new state doc, no If-Match/If-None-Match -> 204 (must stay).
    const put1 = await fetch(url, {
      method: 'PUT',
      headers: { ...V20, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ value: 'original' }),
    });
    expect(put1.status).toBe(204);

    // 2. PUT the SAME (now existing) doc again, no precondition -> 409.
    const put2 = await fetch(url, {
      method: 'PUT',
      headers: { ...V20, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ value: 'modified' }),
    });
    expect(put2.status).toBe(409);
    const body = (await put2.json()) as { error?: string };
    expect(body.error).toBeTruthy();

    // The stored doc must be UNCHANGED (the 409 threw before the upsert).
    const get = await fetch(url, { headers: { ...V20, ...authHeaders } });
    expect(get.status).toBe(200);
    expect((await get.json()) as unknown).toEqual({ value: 'original' });
  });

  test('1.0.3: re-PUT existing doc without precondition -> 204 (State excluded from concurrency)', async ({
    server,
    basicAuth,
  }) => {
    const activityId = `http://example.com/activities/state-conc-${randomUUID()}`;
    const stateId = 'state-1';
    const url = stateUrl(server.apiUrl, activityId, stateId);
    const authHeaders = { Authorization: `Basic ${basicAuth}` };

    const put1 = await fetch(url, {
      method: 'PUT',
      headers: { ...V103, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ value: 'original' }),
    });
    expect(put1.status).toBe(204);

    // Re-PUT existing with no precondition -> 204 under 1.0.3.
    const put2 = await fetch(url, {
      method: 'PUT',
      headers: { ...V103, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ value: 'modified' }),
    });
    expect(put2.status).toBe(204);

    const get = await fetch(url, { headers: { ...V103, ...authHeaders } });
    expect(get.status).toBe(200);
    expect((await get.json()) as unknown).toEqual({ value: 'modified' });
  });

  test('2.0: PUT existing with CORRECT If-Match -> 204; WRONG If-Match -> 412', async ({ server, basicAuth }) => {
    const activityId = `http://example.com/activities/state-conc-${randomUUID()}`;
    const stateId = 'state-1';
    const url = stateUrl(server.apiUrl, activityId, stateId);
    const authHeaders = { Authorization: `Basic ${basicAuth}` };

    const put1 = await fetch(url, {
      method: 'PUT',
      headers: { ...V20, 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ value: 'original' }),
    });
    expect(put1.status).toBe(204);

    // Fetch the current ETag.
    const get = await fetch(url, { headers: { ...V20, ...authHeaders } });
    expect(get.status).toBe(200);
    const etag = get.headers.get('ETag');
    expect(etag).toBeTruthy();

    // WRONG If-Match -> 412.
    const putWrong = await fetch(url, {
      method: 'PUT',
      headers: { ...V20, 'Content-Type': 'application/json', 'If-Match': '"deadbeef"', ...authHeaders },
      body: JSON.stringify({ value: 'modified' }),
    });
    expect(putWrong.status).toBe(412);

    // CORRECT If-Match -> 204.
    const putRight = await fetch(url, {
      method: 'PUT',
      headers: { ...V20, 'Content-Type': 'application/json', 'If-Match': etag!, ...authHeaders },
      body: JSON.stringify({ value: 'modified' }),
    });
    expect(putRight.status).toBe(204);

    const getAfter = await fetch(url, { headers: { ...V20, ...authHeaders } });
    expect((await getAfter.json()) as unknown).toEqual({ value: 'modified' });
  });
});
