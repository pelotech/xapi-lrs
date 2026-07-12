/**
 * Integration Tests: StatementRef decomposition (statement_to_statement).
 *
 * Pins lrsql v0.9.5's column semantics (ops/command/statement.clj +
 * query.sql stmt-ref-subquery): ancestor_id = the referencing statement,
 * descendant_id = the referenced target, PLUS transitive links (the
 * referencer also links to each of the target's own descendants). Takeover
 * round-trips depend on this direction — lrsql-written rows must read
 * correctly to us and vice versa.
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

const TARGET_VERB = 'http://example.com/verbs/statement-refs-target';
const REF_VERB = 'http://example.com/verbs/statement-refs-referencer';
const VOIDED_VERB = 'http://adlnet.gov/expapi/verbs/voided';

describe('StatementRef relationships (statement_to_statement)', () => {
  test('writes lrsql-direction rows with transitive links and keeps voided-target retrieval', async ({
    server,
    pool,
    basicAuth,
  }) => {
    const headers = {
      ...V,
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuth}`,
    };
    const actor = { mbox: 'mailto:statement-refs@example.com' };

    const bId = randomUUID();
    const aId = randomUUID();
    const cId = randomUUID();

    // B: plain statement (will be voided by A)
    let res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: bId,
        actor,
        verb: { id: TARGET_VERB, display: { 'en-US': 'targeted' } },
        object: { id: 'http://example.com/activities/statement-refs' },
      }),
    });
    expect(res.status).toBe(200);

    // A: voids B (StatementRef -> B)
    res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: aId,
        actor,
        verb: { id: VOIDED_VERB, display: { 'en-US': 'voided' } },
        object: { objectType: 'StatementRef', id: bId },
      }),
    });
    expect(res.status).toBe(200);

    // C: references A (StatementRef -> A, non-voiding)
    res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: cId,
        actor,
        verb: { id: REF_VERB, display: { 'en-US': 'referenced' } },
        object: { objectType: 'StatementRef', id: aId },
      }),
    });
    expect(res.status).toBe(200);

    // Raw rows: ancestor = referencer, descendant = target (lrsql
    // direction), plus C's transitive link to B via A.
    const { rows } = await pool.query<{ ancestor_id: string; descendant_id: string }>({
      text: `SELECT ancestor_id, descendant_id FROM statement_to_statement
             WHERE ancestor_id = ANY($1::uuid[]) OR descendant_id = ANY($1::uuid[])
             ORDER BY ancestor_id, descendant_id`,
      values: [[aId, bId, cId]],
    });
    const pairs = rows.map((r) => `${r.ancestor_id}->${r.descendant_id}`).sort();
    expect(pairs).toEqual(
      [
        `${aId}->${bId}`, // A references B (direct)
        `${cId}->${aId}`, // C references A (direct)
        `${cId}->${bId}`, // C -> B (transitive, copied from A -> B)
      ].sort(),
    );

    // Retrieval semantics (xAPI 2.4.2 / XAPI-00162): filtering on the
    // voided statement's verb must exclude voided B itself but return the
    // statements targeting it — A directly, C via the transitive link
    // (lrsql parity).
    res = await fetch(`${server.apiUrl}/xapi/statements?verb=${encodeURIComponent(TARGET_VERB)}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { statements: Array<{ id: string }> };
    const ids = body.statements.map((s) => s.id);
    expect(ids).not.toContain(bId);
    expect(ids).toContain(aId);
    expect(ids).toContain(cId);

    // Voided B stays retrievable by voidedStatementId.
    res = await fetch(`${server.apiUrl}/xapi/statements?voidedStatementId=${bId}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(res.status).toBe(200);
    const voided = (await res.json()) as { id: string };
    expect(voided.id).toBe(bId);
  });
});
