/**
 * Integration tests: Last-Modified header on single-statement GET (design 2e).
 *
 * The v2_0 ADL conformance battery (test/v2_0/4.1.6.1-Statement-Resource.js)
 * asserts a single-statement GET response carries a Last-Modified header that
 * parses to the statement's `stored` timestamp (compared to the second).
 */

import { randomUUID } from 'node:crypto';
import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

describe('Statement GET Last-Modified header', () => {
  test('single-statement GET (?statementId=) carries Last-Modified matching stored', async ({ server, basicAuth }) => {
    const headers = {
      ...V,
      'Content-Type': 'application/json',
      Authorization: `Basic ${basicAuth}`,
    };
    const id = randomUUID();

    let res = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id,
        actor: { mbox: 'mailto:last-modified@example.com' },
        verb: { id: 'http://example.com/verbs/last-modified', display: { 'en-US': 'tested' } },
        object: { id: 'http://example.com/activities/last-modified' },
      }),
    });
    expect(res.status).toBe(200);

    res = await fetch(`${server.apiUrl}/xapi/statements?statementId=${id}`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(res.status).toBe(200);

    const lastModified = res.headers.get('Last-Modified');
    expect(lastModified).toBeTruthy();
    expect(Number.isNaN(Date.parse(lastModified!))).toBe(false);

    const body = (await res.json()) as { stored: string };
    expect(new Date(lastModified!).toUTCString()).toBe(new Date(body.stored).toUTCString());
  });

  test('multi-statement query response has no Last-Modified header', async ({ server, basicAuth }) => {
    const res = await fetch(`${server.apiUrl}/xapi/statements?limit=1`, {
      headers: { ...V, Authorization: `Basic ${basicAuth}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Last-Modified')).toBeNull();
  });
});
