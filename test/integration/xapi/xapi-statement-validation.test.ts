/**
 * Integration Tests: xAPI Statement Validation
 * Tests that the LRS accepts generic xAPI 1.0.3 statements.
 *
 * Statement content validation (missing actor/verb/object, invalid IFI, etc.)
 * is not yet implemented in the LRS — those tests are marked .todo().
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalStatement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: { mbox: 'mailto:test@example.com' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    object: { id: 'http://example.com/activities/1' },
    ...overrides,
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

async function getStatement(apiUrl: string, auth: string, statementId: string) {
  return fetch(`${apiUrl}/xapi/statements?statementId=${statementId}`, {
    headers: { Authorization: `Basic ${auth}`, ...V },
  });
}

// =========================================================================
// POST generic statements (acceptance)
// =========================================================================

describe('POST generic xAPI statements', () => {
  test('accepts statement with mbox actor', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, minimalStatement());
    expect(resp.status).toBe(200);
    const ids = await resp.json();
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-/i); // UUID
  });

  test('accepts statement with mbox_sha1sum actor', async ({ server, basicAuth }) => {
    const resp = await postStatement(
      server.apiUrl,
      basicAuth,
      minimalStatement({
        actor: { mbox_sha1sum: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
      }),
    );
    expect(resp.status).toBe(200);
  });

  test('accepts statement with openid actor', async ({ server, basicAuth }) => {
    const resp = await postStatement(
      server.apiUrl,
      basicAuth,
      minimalStatement({
        actor: { openid: 'http://example.com/user/123' },
      }),
    );
    expect(resp.status).toBe(200);
  });

  test('accepts statement with account actor', async ({ server, basicAuth }) => {
    const resp = await postStatement(
      server.apiUrl,
      basicAuth,
      minimalStatement({
        actor: { account: { homePage: 'http://example.com', name: 'user1' } },
      }),
    );
    expect(resp.status).toBe(200);
  });

  test('generates id when missing', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, minimalStatement());
    expect(resp.status).toBe(200);
    const ids = await resp.json();
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  test('generates timestamp when missing', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const resp = await postStatement(server.apiUrl, basicAuth, minimalStatement({ id }));
    expect(resp.status).toBe(200);

    const getResp = await getStatement(server.apiUrl, basicAuth, id);
    const stmt = await getResp.json();
    expect(stmt.timestamp).toBeDefined();
    expect(Number.isNaN(new Date(stmt.timestamp).getTime())).toBe(false);
  });

  test('accepts statement without context', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, minimalStatement());
    expect(resp.status).toBe(200);
  });

  test('accepts statement without objectType (defaults to Activity)', async ({ server, basicAuth }) => {
    const resp = await postStatement(
      server.apiUrl,
      basicAuth,
      minimalStatement({
        object: { id: 'http://example.com/act' },
      }),
    );
    expect(resp.status).toBe(200);
  });

  test('accepts batch of generic statements', async ({ server, basicAuth }) => {
    const stmts = [minimalStatement({ id: randomUUID() }), minimalStatement({ id: randomUUID() })];
    const resp = await postStatement(server.apiUrl, basicAuth, stmts);
    expect(resp.status).toBe(200);
    const ids = await resp.json();
    expect(ids).toHaveLength(2);
  });

  test('GET returns stored, authority, and server-generated fields', async ({ server, basicAuth }) => {
    const id = randomUUID();
    await postStatement(server.apiUrl, basicAuth, minimalStatement({ id }));

    const getResp = await getStatement(server.apiUrl, basicAuth, id);
    expect(getResp.status).toBe(200);
    const stmt = await getResp.json();
    expect(stmt.stored).toBeDefined();
    expect(stmt.id).toBe(id);
  });
});

// =========================================================================
// POST invalid statements — key rejection paths
// =========================================================================

describe('POST invalid xAPI statements', () => {
  test('rejects statement missing actor', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
      object: { id: 'http://example.com/activities/1' },
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/actor/i);
  });

  test('rejects statement missing verb', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      actor: { mbox: 'mailto:test@example.com' },
      object: { id: 'http://example.com/activities/1' },
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/verb/i);
  });

  test('rejects statement missing object', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/object/i);
  });

  test('rejects statement with null value in result', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
      object: { id: 'http://example.com/activities/1' },
      result: { success: null },
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/[Nn]ull/);
  });

  test('rejects statement with invalid verb IRI (no scheme)', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'not-a-valid-iri', display: { 'en-US': 'did' } },
      object: { id: 'http://example.com/activities/1' },
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/verb/i);
  });
});

// =========================================================================
// PUT statements
// =========================================================================

describe('PUT xAPI statements', () => {
  test('PUT generic statement with matching statementId', async ({ server, basicAuth }) => {
    const id = randomUUID();
    const resp = await putStatement(server.apiUrl, basicAuth, id, minimalStatement());
    expect(resp.status).toBe(204);
  });

  test('PUT with mismatched body id and query statementId', async ({ server, basicAuth }) => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const resp = await putStatement(server.apiUrl, basicAuth, id1, minimalStatement({ id: id2 }));
    expect(resp.status).toBe(409);
  });

  test('GET returns PUT statement', async ({ server, basicAuth }) => {
    const id = randomUUID();
    await putStatement(server.apiUrl, basicAuth, id, minimalStatement());

    const getResp = await getStatement(server.apiUrl, basicAuth, id);
    expect(getResp.status).toBe(200);
    const stmt = await getResp.json();
    expect(stmt.id).toBe(id);
    expect(stmt.stored).toBeDefined();
  });
});

// =========================================================================
// Conformance test before-hook statement
// =========================================================================

describe('ADL conformance test before-hook statement', () => {
  test('accepts the before-hook statement that was previously rejected', async ({ server, basicAuth }) => {
    const resp = await postStatement(server.apiUrl, basicAuth, {
      actor: { mbox: 'mailto:test@example.com', name: 'test' },
      verb: {
        id: 'http://adlnet.gov/expapi/verbs/experienced',
        display: { 'en-US': 'experienced' },
      },
      object: { id: 'http://tincanapi.com/conformancetest/activityid/0' },
    });
    expect(resp.status).toBe(200);
    const ids = await resp.json();
    expect(ids).toHaveLength(1);
  });
});
