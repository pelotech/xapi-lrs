/**
 * Integration Tests: xAPI Version Header Validation
 * Tests X-Experience-API-Version request header enforcement per xAPI §6.2.
 *
 * - Missing version header is rejected with 400 (except /about)
 * - Any version starting with "1.0" is accepted
 * - Versions not starting with "1.0" are rejected with 400
 */

import { test, describe, expect } from '../fixtures.ts';

describe('xAPI Version Header Validation', () => {
  // =========================================================================
  // Exemptions
  // =========================================================================

  test('GET /xapi/about succeeds without version header', async ({ server }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/about`);
    expect(resp.status).toBe(200);
  });

  test('OPTIONS preflight succeeds for CORS', async ({ server }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      method: 'OPTIONS',
    });
    // OPTIONS preflight must succeed (204) for CORS to work; version check
    // only applies to actual requests, not preflight.
    expect(resp.status).toBe(204);
  });

  // =========================================================================
  // Missing header — LRS rejects with 400 per xAPI §6.2
  // =========================================================================

  test('GET /xapi/statements without version header returns 400', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(resp.status).toBe(400);
  });

  // =========================================================================
  // Incompatible versions → 400
  // =========================================================================

  test('rejects version 0.9.5 (< 1.0)', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '0.9.5',
      },
    });
    expect(resp.status).toBe(400);
  });

  test('rejects version 1.1.0 (>= 1.1)', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.1.0',
      },
    });
    expect(resp.status).toBe(400);
  });

  test('rejects version 2.0.0', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '2.0.0',
      },
    });
    expect(resp.status).toBe(400);
  });

  // =========================================================================
  // Compatible versions → pass through to auth/handler
  // =========================================================================

  test('accepts version 1.0', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0',
      },
    });
    expect(resp.status).not.toBe(400);
  });

  test('accepts version 1.0.0', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0.0',
      },
    });
    expect(resp.status).not.toBe(400);
  });

  test('accepts version 1.0.3', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Experience-API-Version': '1.0.3',
      },
    });
    expect(resp.status).toBe(200);
  });

  // =========================================================================
  // Response header
  // =========================================================================

  test('response always includes X-Experience-API-Version: 1.0.3', async ({ server }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/about`);
    expect(resp.headers.get('X-Experience-API-Version')).toBe('1.0.3');
  });

  test('error response includes version header even when request version missing', async ({ server, authToken }) => {
    const resp = await fetch(`${server.apiUrl}/xapi/statements`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    // Request is rejected (400) but version header is still set on the response
    expect(resp.status).toBe(400);
    expect(resp.headers.get('X-Experience-API-Version')).toBe('1.0.3');
  });
});
