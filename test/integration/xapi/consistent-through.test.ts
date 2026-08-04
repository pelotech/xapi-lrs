/**
 * Integration tests: X-Experience-API-Consistent-Through must be a
 * CONSERVATIVE visibility bound — never at or past the `stored` of a
 * statement whose write transaction has not committed.
 *
 * The race this guards (reported by a downstream ingestion team): `stored` is
 * stamped when the INSERT is issued, but the row only becomes visible at
 * COMMIT. A consumer that advances an ingestion watermark to the header value
 * would, if the header were bare now(), skip such a statement permanently —
 * every subsequent query window starts after it, and `more` never helps
 * because the statement was in no page of any query.
 *
 * The pg-only race test drives that window directly: hold a write transaction
 * open on one connection and assert the header served on another stays behind
 * it. PGlite is exempt (and skipped): its single connection cannot interleave
 * a GET with an open write transaction, so the race is unreachable there.
 */

import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../../src/db.ts';
import { insertStatement } from '../../../src/repositories/statements.ts';
import { test, describe, expect, createTestPool } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

const AUTHORITY = { mbox: 'mailto:test-authority@example.com' } as const;

function ctHeader(res: Response): string {
  const ct = res.headers.get('x-experience-api-consistent-through');
  expect(ct).toBeTruthy();
  return ct as string;
}

describe.skipIf(process.env['DATABASE_DRIVER'] === 'pglite')(
  'X-Experience-API-Consistent-Through vs in-flight writes',
  () => {
    test('stays behind an uncommitted statement, advances past it after commit', async ({ server, basicAuth }) => {
      const headers = { ...V, Authorization: `Basic ${basicAuth}` };
      const raw = createTestPool();
      const writer = await raw.connect();
      const id = randomUUID();
      let storedAt: Date;

      try {
        // Open a write transaction and stamp `stored` from it, exactly as the
        // POST handler does — so this statement's stored == the transaction's
        // pg_stat_activity.xact_start.
        await writer.query('BEGIN');
        const { rows } = await writer.query('SELECT now() AS txn_now');
        storedAt = rows[0].txn_now as Date;

        await insertStatement(
          writer as unknown as DbClient,
          {
            id,
            actor: { mbox: 'mailto:ct-race@example.com' },
            verb: { id: 'http://example.com/verbs/ct-race', display: { 'en-US': 'raced' } },
            object: { id: 'http://example.com/activities/ct-race' },
          },
          AUTHORITY,
          storedAt,
        );

        // Transaction still open: the statement is invisible to this GET, so
        // the header must not claim it.
        const during = await fetch(`${server.apiUrl}/xapi/statements?limit=1`, { headers });
        expect(new Date(ctHeader(during)).getTime()).toBeLessThan(storedAt.getTime());

        await writer.query('COMMIT');
      } finally {
        writer.release();
        await raw.end();
      }

      // Committed: the header must eventually cover it. Polled because a
      // PARALLEL test file's own (short-lived) write transaction can briefly
      // pin the bound below storedAt — correct behaviour, just not instant.
      await expect
        .poll(
          async () => {
            const res = await fetch(`${server.apiUrl}/xapi/statements?limit=1`, {
              headers: { ...V, Authorization: `Basic ${basicAuth}` },
            });
            return new Date(ctHeader(res)).getTime();
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(storedAt.getTime());

      // ...and the statement really is queryable.
      const got = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
        headers: { ...V, Authorization: `Basic ${basicAuth}` },
      });
      expect(got.status).toBe(200);
    });
  },
);

describe('X-Experience-API-Consistent-Through header contract', () => {
  test('GET /xapi/statements emits a parseable, non-future timestamp', async ({ server, basicAuth }) => {
    // Generous slack both ways: the bound is DB-clock, the assertions are
    // app-clock, and the bound legitimately trails now() under load.
    const before = Date.now() - 300_000;
    const res = await fetch(`${server.apiUrl}/xapi/statements?limit=1`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(res.status).toBe(200);

    const t = new Date(ctHeader(res)).getTime();
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThan(before);
    expect(t).toBeLessThanOrEqual(Date.now() + 300_000);
  });

  test('a statement POSTed and then read back is covered by the header', async ({ server, basicAuth }) => {
    const headers = { ...V, 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` };
    const id = randomUUID();
    const post = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          id,
          actor: { mbox: 'mailto:ct-committed@example.com' },
          verb: { id: 'http://example.com/verbs/ct-committed', display: { 'en-US': 'committed' } },
          object: { id: 'http://example.com/activities/ct-committed' },
        },
      ]),
    });
    expect(post.status).toBe(200);

    const got = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(got.status).toBe(200);
    const stored = new Date(((await got.json()) as { stored: string }).stored).getTime();

    // The write is committed and visible, so the bound must reach it.
    await expect
      .poll(
        async () => {
          const res = await fetch(`${server.apiUrl}/xapi/statements?limit=1`, {
            headers: { ...V, Authorization: `Basic ${basicAuth}` },
          });
          return new Date(ctHeader(res)).getTime();
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(stored);
  });
});
