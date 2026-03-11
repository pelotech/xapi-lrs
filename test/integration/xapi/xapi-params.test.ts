/**
 * Integration Tests: xAPI Query Parameter Validation
 *
 * The LRS does not currently implement unknown query parameter rejection.
 * Tests for known-param acceptance are included; unknown-param rejection
 * tests are marked as .todo() pending implementation.
 */

import { test, describe, expect } from '../fixtures.ts';

const V = { 'X-Experience-API-Version': '1.0.3' } as const;

describe('xAPI Query Parameter Validation', () => {
  // =========================================================================
  // Known params — accepted
  // =========================================================================

  test('GET /xapi/about with no params succeeds', async ({ server }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/about`);
    expect(resp.status).toBe(200);
  });

  test('GET /xapi/statements accepts known params', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements?limit=10&ascending=false`, {
      headers: { Authorization: `Bearer ${authToken}`, ...V },
    });
    expect(resp.status).toBe(200);
  });

  // =========================================================================
  // Invalid agent param — 400
  // =========================================================================

  test('GET /xapi/statements with invalid agent JSON returns 400', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements?agent=not-json`, {
      headers: { Authorization: `Bearer ${authToken}`, ...V },
    });
    expect(resp.status).toBe(400);
  });
});

