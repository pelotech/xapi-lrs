/**
 * Integration Tests: xAPI Statement Query Filters + Voiding
 *
 * Exercises queryStatements SQL builder: verb/agent/activity/registration
 * filters, since/until time-based filtering, ascending/limit, and the
 * voided-statement-targeting logic from xAPI §2.4.1.
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stmt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    actor: { mbox: 'mailto:query-test@example.com' },
    verb: { id: 'http://example.com/verbs/did', display: { 'en-US': 'did' } },
    object: { id: 'http://example.com/activities/1' },
    ...overrides,
  };
}

async function post(apiUrl: string, auth: string, body: unknown): Promise<Response> {
  return fetch(`${apiUrl}/xapi/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}`, ...V },
    body: JSON.stringify(body),
  });
}

async function get(apiUrl: string, auth: string, params: Record<string, string> = {}): Promise<Response> {
  const qs = new URLSearchParams(params).toString();
  return fetch(`${apiUrl}/xapi/statements${qs ? '?' + qs : ''}`, {
    headers: { Authorization: `Basic ${auth}`, ...V },
  });
}

function ids(result: { statements: Array<{ id: string }> }): string[] {
  return result.statements.map((s) => s.id);
}

// =========================================================================
// Verb filter
// =========================================================================

describe('verb filter', () => {
  test('returns only statements matching the verb IRI', async ({ server, basicAuth }) => {
    const verbA = `http://example.com/verbs/${randomUUID()}`;
    const verbB = `http://example.com/verbs/${randomUUID()}`;
    const idA = randomUUID();
    const idB = randomUUID();

    const resp = await post(server.apiUrl, basicAuth, [
      stmt({ id: idA, verb: { id: verbA } }),
      stmt({ id: idB, verb: { id: verbB } }),
    ]);
    expect(resp.status).toBe(200);

    const result = await (await get(server.apiUrl, basicAuth, { verb: verbA })).json();
    expect(ids(result)).toContain(idA);
    expect(ids(result)).not.toContain(idB);
  });
});

// =========================================================================
// Agent filter
// =========================================================================

describe('agent filter', () => {
  test('filters by actor (default, no related_agents)', async ({ server, basicAuth }) => {
    const mboxA = `mailto:agent-a-${randomUUID().slice(0, 8)}@example.com`;
    const mboxB = `mailto:agent-b-${randomUUID().slice(0, 8)}@example.com`;
    const idA = randomUUID();
    const idB = randomUUID();

    await post(server.apiUrl, basicAuth, [
      stmt({ id: idA, actor: { mbox: mboxA } }),
      stmt({ id: idB, actor: { mbox: mboxB } }),
    ]);

    const result = await (
      await get(server.apiUrl, basicAuth, { agent: JSON.stringify({ mbox: mboxA }) })
    ).json();
    expect(ids(result)).toContain(idA);
    expect(ids(result)).not.toContain(idB);
  });

  test('related_agents=true matches context.instructor', async ({ server, basicAuth }) => {
    const mbox = `mailto:instr-${randomUUID().slice(0, 8)}@example.com`;
    const id = randomUUID();

    await post(server.apiUrl, basicAuth, [
      stmt({
        id,
        actor: { mbox: 'mailto:other@example.com' },
        context: { instructor: { objectType: 'Agent', mbox } },
      }),
    ]);

    // Without related_agents — should not match
    const withoutRelated = await (
      await get(server.apiUrl, basicAuth, { agent: JSON.stringify({ mbox }) })
    ).json();
    expect(ids(withoutRelated)).not.toContain(id);

    // With related_agents — should match
    const withRelated = await (
      await get(server.apiUrl, basicAuth, {
        agent: JSON.stringify({ mbox }),
        related_agents: 'true',
      })
    ).json();
    expect(ids(withRelated)).toContain(id);
  });
});

// =========================================================================
// Activity filter
// =========================================================================

describe('activity filter', () => {
  test('filters by object activity IRI', async ({ server, basicAuth }) => {
    const actA = `http://example.com/act/${randomUUID()}`;
    const actB = `http://example.com/act/${randomUUID()}`;
    const idA = randomUUID();
    const idB = randomUUID();

    await post(server.apiUrl, basicAuth, [
      stmt({ id: idA, object: { id: actA } }),
      stmt({ id: idB, object: { id: actB } }),
    ]);

    const result = await (await get(server.apiUrl, basicAuth, { activity: actA })).json();
    expect(ids(result)).toContain(idA);
    expect(ids(result)).not.toContain(idB);
  });

  test('related_activities=true matches contextActivities.parent', async ({ server, basicAuth }) => {
    const parentAct = `http://example.com/act/${randomUUID()}`;
    const id = randomUUID();

    await post(server.apiUrl, basicAuth, [
      stmt({
        id,
        context: { contextActivities: { parent: [{ id: parentAct }] } },
      }),
    ]);

    // Without related_activities — should not match (parentAct is not the object)
    const without = await (await get(server.apiUrl, basicAuth, { activity: parentAct })).json();
    expect(ids(without)).not.toContain(id);

    // With related_activities — should match
    const withRelated = await (
      await get(server.apiUrl, basicAuth, { activity: parentAct, related_activities: 'true' })
    ).json();
    expect(ids(withRelated)).toContain(id);
  });
});

// =========================================================================
// Registration filter
// =========================================================================

describe('registration filter', () => {
  test('filters by context.registration UUID', async ({ server, basicAuth }) => {
    const regA = randomUUID();
    const regB = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();

    await post(server.apiUrl, basicAuth, [
      stmt({ id: idA, context: { registration: regA } }),
      stmt({ id: idB, context: { registration: regB } }),
    ]);

    const result = await (await get(server.apiUrl, basicAuth, { registration: regA })).json();
    expect(ids(result)).toContain(idA);
    expect(ids(result)).not.toContain(idB);
  });
});

// =========================================================================
// Since / Until
// =========================================================================

describe('since / until', () => {
  test('since excludes statements stored before the timestamp', async ({ server, basicAuth }) => {
    const idOld = randomUUID();
    await post(server.apiUrl, basicAuth, [stmt({ id: idOld })]);

    // Small delay to ensure different stored timestamps
    await new Promise((r) => setTimeout(r, 50));
    const midpoint = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 50));

    const idNew = randomUUID();
    await post(server.apiUrl, basicAuth, [stmt({ id: idNew })]);

    const result = await (await get(server.apiUrl, basicAuth, { since: midpoint })).json();
    expect(ids(result)).toContain(idNew);
    expect(ids(result)).not.toContain(idOld);
  });

  test('until excludes statements stored after the timestamp', async ({ server, basicAuth }) => {
    const idOld = randomUUID();
    await post(server.apiUrl, basicAuth, [stmt({ id: idOld })]);

    await new Promise((r) => setTimeout(r, 50));
    const midpoint = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 50));

    const idNew = randomUUID();
    await post(server.apiUrl, basicAuth, [stmt({ id: idNew })]);

    const result = await (await get(server.apiUrl, basicAuth, { until: midpoint })).json();
    expect(ids(result)).toContain(idOld);
    expect(ids(result)).not.toContain(idNew);
  });
});

// =========================================================================
// Ascending / Limit
// =========================================================================

describe('ascending and limit', () => {
  test('ascending=true returns oldest first', async ({ server, basicAuth }) => {
    const verb = `http://example.com/verbs/${randomUUID()}`;
    const id1 = randomUUID();
    const id2 = randomUUID();

    await post(server.apiUrl, basicAuth, [stmt({ id: id1, verb: { id: verb } })]);
    await new Promise((r) => setTimeout(r, 10));
    await post(server.apiUrl, basicAuth, [stmt({ id: id2, verb: { id: verb } })]);

    const result = await (
      await get(server.apiUrl, basicAuth, { verb, ascending: 'true' })
    ).json();
    const stmtIds = ids(result);
    expect(stmtIds.indexOf(id1)).toBeLessThan(stmtIds.indexOf(id2));
  });

  test('limit caps the number of returned statements', async ({ server, basicAuth }) => {
    const verb = `http://example.com/verbs/${randomUUID()}`;

    await post(server.apiUrl, basicAuth, [
      stmt({ verb: { id: verb } }),
      stmt({ verb: { id: verb } }),
      stmt({ verb: { id: verb } }),
    ]);

    const result = await (
      await get(server.apiUrl, basicAuth, { verb, limit: '2' })
    ).json();
    expect(result.statements).toHaveLength(2);
  });
});

// =========================================================================
// Voiding + Targeting (xAPI §2.4.1, XAPI-00162)
// =========================================================================

describe('voiding and targeting', () => {
  test('voided statement is excluded from default query', async ({ server, basicAuth }) => {
    const verb = `http://example.com/verbs/${randomUUID()}`;
    const voidedId = randomUUID();

    // Store then void
    await post(server.apiUrl, basicAuth, [stmt({ id: voidedId, verb: { id: verb } })]);
    await post(server.apiUrl, basicAuth, [
      {
        id: randomUUID(),
        actor: { mbox: 'mailto:query-test@example.com' },
        verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
        object: { objectType: 'StatementRef', id: voidedId },
      },
    ]);

    const result = await (await get(server.apiUrl, basicAuth, { verb })).json();
    expect(ids(result)).not.toContain(voidedId);
  });

  test('voided statement accessible via voidedStatementId', async ({ server, basicAuth }) => {
    const voidedId = randomUUID();

    await post(server.apiUrl, basicAuth, [stmt({ id: voidedId })]);
    await post(server.apiUrl, basicAuth, [
      {
        id: randomUUID(),
        actor: { mbox: 'mailto:query-test@example.com' },
        verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
        object: { objectType: 'StatementRef', id: voidedId },
      },
    ]);

    const resp = await get(server.apiUrl, basicAuth, { voidedStatementId: voidedId });
    expect(resp.status).toBe(200);
    const s = await resp.json();
    expect(s.id).toBe(voidedId);
  });

  test('voiding + StatementRef statements returned when querying by verb matching voided target', async ({
    server,
    basicAuth,
  }) => {
    const verb = `http://example.com/verbs/${randomUUID()}`;
    const voidedId = randomUUID();
    const voidingId = randomUUID();
    const refId = randomUUID();

    // 1. Statement that will be voided (verb matches filter)
    await post(server.apiUrl, basicAuth, [stmt({ id: voidedId, verb: { id: verb } })]);

    // 2. Voiding statement (different verb — voided verb)
    await post(server.apiUrl, basicAuth, [
      {
        id: voidingId,
        actor: { mbox: 'mailto:query-test@example.com' },
        verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
        object: { objectType: 'StatementRef', id: voidedId },
      },
    ]);

    // 3. StatementRef pointing to voided statement (verb matches filter)
    await post(server.apiUrl, basicAuth, [
      {
        id: refId,
        actor: { mbox: 'mailto:query-test@example.com' },
        verb: { id: verb, display: { 'en-US': 'did' } },
        object: { objectType: 'StatementRef', id: voidedId },
      },
    ]);

    const result = await (await get(server.apiUrl, basicAuth, { verb })).json();
    const resultIds = ids(result);

    // Voided statement must NOT be returned
    expect(resultIds).not.toContain(voidedId);
    // Voiding statement and StatementRef MUST be returned (they target the voided stmt)
    expect(resultIds).toContain(voidingId);
    expect(resultIds).toContain(refId);
  });

  test('GET ?statementId for voided statement returns 404', async ({ server, basicAuth }) => {
    const voidedId = randomUUID();

    await post(server.apiUrl, basicAuth, [stmt({ id: voidedId })]);
    await post(server.apiUrl, basicAuth, [
      {
        id: randomUUID(),
        actor: { mbox: 'mailto:query-test@example.com' },
        verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
        object: { objectType: 'StatementRef', id: voidedId },
      },
    ]);

    const resp = await get(server.apiUrl, basicAuth, { statementId: voidedId });
    expect(resp.status).toBe(404);
  });
});

// =========================================================================
// Parameter validation
// =========================================================================

describe('query parameter validation', () => {
  test('statementId + verb returns 400', async ({ server, basicAuth }) => {
    const resp = await get(server.apiUrl, basicAuth, {
      statementId: randomUUID(),
      verb: 'http://example.com/verbs/did',
    });
    expect(resp.status).toBe(400);
  });

  test('statementId + voidedStatementId returns 400', async ({ server, basicAuth }) => {
    const resp = await get(server.apiUrl, basicAuth, {
      statementId: randomUUID(),
      voidedStatementId: randomUUID(),
    });
    expect(resp.status).toBe(400);
  });

  test('invalid format value returns 400', async ({ server, basicAuth }) => {
    const resp = await get(server.apiUrl, basicAuth, { format: 'bogus' });
    expect(resp.status).toBe(400);
  });
});
