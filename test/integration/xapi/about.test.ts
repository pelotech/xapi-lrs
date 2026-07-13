/**
 * Integration tests: About resource (GET /xapi/about).
 *
 * The About resource is unauthenticated and advertises every xAPI version the
 * LRS supports. The v2_0 conformance battery (XAPI-00317) requires the exact
 * string "2.0.0" to appear in the advertised `version` array.
 */

import { test, describe, expect } from '../fixtures.ts';

describe('About resource', () => {
  test('advertises both xAPI 1.0.3 and 2.0.0', async ({ server }) => {
    const res = await fetch(`${server.apiUrl}/xapi/about`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { version: string[] };
    expect(Array.isArray(body.version)).toBe(true);
    expect(body.version).toContain('1.0.3');
    expect(body.version).toContain('2.0.0');
  });

  test('echoes the requested 2.0.0 version header', async ({ server }) => {
    const res = await fetch(`${server.apiUrl}/xapi/about`, {
      headers: { 'X-Experience-API-Version': '2.0.0' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Experience-API-Version')).toBe('2.0.0');
  });
});
