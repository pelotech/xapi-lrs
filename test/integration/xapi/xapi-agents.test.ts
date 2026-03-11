/**
 * Integration Tests: xAPI Agents Resource (Person Object)
 *
 * GET /xapi/agents should return a Person Object that merges all known
 * IFI values for the given agent from stored statements.
 * When no statements match, it falls back to echoing the input IFIs.
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    actor: { mbox: 'mailto:agent-test@example.com' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    object: { id: 'http://example.com/activities/1' },
    timestamp: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

async function postStatements(apiUrl: string, auth: string, stmts: unknown[]): Promise<void> {
  const resp = await fetch(`${apiUrl}/xapi/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}`, ...V },
    body: JSON.stringify(stmts),
  });
  expect(resp.status).toBe(200);
}

async function getAgent(apiUrl: string, auth: string, agentJson: string): Promise<Response> {
  return fetch(`${apiUrl}/xapi/agents?agent=${encodeURIComponent(agentJson)}`, {
    headers: { Authorization: `Basic ${auth}`, ...V },
  });
}

// =========================================================================
// Person Object merge from statements
// =========================================================================

describe('GET /xapi/agents — Person Object', () => {
  test('agent with mbox appearing in 2 statements with different names returns both names', async ({
    server,
    basicAuth,
  }) => {
    const mbox = `mailto:merge-${randomUUID().slice(0, 8)}@example.com`;

    await postStatements(server.apiUrl, basicAuth, [
      makeStatement({ actor: { mbox, name: 'Alice' } }),
      makeStatement({ actor: { mbox, name: 'Bob' } }),
    ]);

    const resp = await getAgent(server.apiUrl, basicAuth, JSON.stringify({ mbox }));
    expect(resp.status).toBe(200);

    const person = await resp.json();
    expect(person.objectType).toBe('Person');
    expect(person.mbox).toContain(mbox);
    expect(person.name).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    expect(person.name).toHaveLength(2);
  });

  test('agent with account IFI returns correct merged Person', async ({ server, basicAuth }) => {
    const account = { homePage: 'http://example.com', name: `user-${randomUUID().slice(0, 8)}` };

    await postStatements(server.apiUrl, basicAuth, [
      makeStatement({ actor: { account, name: 'Charlie' } }),
    ]);

    const resp = await getAgent(server.apiUrl, basicAuth, JSON.stringify({ account }));
    expect(resp.status).toBe(200);

    const person = await resp.json();
    expect(person.objectType).toBe('Person');
    expect(person.account).toEqual(expect.arrayContaining([account]));
    expect(person.name).toEqual(['Charlie']);
  });

  test('agent with no stored statements falls back to input echo', async ({ server, basicAuth }) => {
    const mbox = `mailto:nobody-${randomUUID().slice(0, 8)}@example.com`;

    const resp = await getAgent(server.apiUrl, basicAuth, JSON.stringify({ mbox }));
    expect(resp.status).toBe(200);

    const person = await resp.json();
    expect(person.objectType).toBe('Person');
    expect(person.mbox).toEqual([mbox]);
  });

  test('Person Object only includes IFI types present in stored statements', async ({ server, basicAuth }) => {
    const mbox = `mailto:multi-${randomUUID().slice(0, 8)}@example.com`;

    await postStatements(server.apiUrl, basicAuth, [makeStatement({ actor: { mbox, name: 'Dana' } })]);

    const resp = await getAgent(server.apiUrl, basicAuth, JSON.stringify({ mbox }));
    expect(resp.status).toBe(200);

    const person = await resp.json();
    expect(person.objectType).toBe('Person');
    expect(person.mbox).toEqual([mbox]);
    expect(person.name).toEqual(['Dana']);
    // Other IFI types not present in any stored statement should be absent
    expect(person.openid).toBeUndefined();
    expect(person.mbox_sha1sum).toBeUndefined();
    expect(person.account).toBeUndefined();
  });

  test('mbox_sha1sum IFI works', async ({ server, basicAuth }) => {
    // mbox_sha1sum must be a 40-character hex string
    const sha1 = randomUUID().replace(/-/g, '') + '00000000';

    await postStatements(server.apiUrl, basicAuth, [
      makeStatement({ actor: { mbox_sha1sum: sha1, name: 'Eve' } }),
    ]);

    const resp = await getAgent(server.apiUrl, basicAuth, JSON.stringify({ mbox_sha1sum: sha1 }));
    expect(resp.status).toBe(200);

    const person = await resp.json();
    expect(person.objectType).toBe('Person');
    expect(person.mbox_sha1sum).toEqual([sha1]);
    expect(person.name).toEqual(['Eve']);
  });
});
