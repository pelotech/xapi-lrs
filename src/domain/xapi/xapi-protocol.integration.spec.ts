import { describe, expect } from 'vitest';
import { apiTest } from '../../test/api-fixture.js';
import { XAPI_HEADERS } from './xapi-test-helpers.js';

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

describe('GET /xapi/about', () => {
  apiTest('returns version list without auth', async ({ fetch }) => {
    const res = await fetch('/xapi/about', {
      headers: { 'X-Experience-API-Version': '1.0.3' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toContain('1.0.3');
    expect(body.version).toContain('1.0.0');
  });

  apiTest('sets X-Experience-API-Version response header', async ({ fetch }) => {
    const res = await fetch('/xapi/about', {
      headers: { 'X-Experience-API-Version': '1.0.3' },
    });

    expect(res.headers.get('x-experience-api-version')).toBe('1.0.3');
  });
});

// ---------------------------------------------------------------------------
// Version middleware (integration)
// ---------------------------------------------------------------------------

describe('xAPI version validation', () => {
  apiTest('rejects requests without version header', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      headers: { 'Authorization': 'Bearer test-token' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_XAPI_VERSION');
  });

  apiTest('rejects version 1.1.0', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      headers: { ...XAPI_HEADERS, 'X-Experience-API-Version': '1.1.0' },
    });

    expect(res.status).toBe(400);
  });

  apiTest('accepts version 1.0.0', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      headers: { ...XAPI_HEADERS, 'X-Experience-API-Version': '1.0.0' },
    });

    // Should get past version check — 200 with empty result from mock pool
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('xAPI authentication', () => {
  apiTest('rejects requests without Authorization header', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      headers: { 'X-Experience-API-Version': '1.0.3' },
    });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

describe('GET /xapi/activities', () => {
  apiTest('returns activity with just id when not in DB', async ({ fetch }) => {
    const res = await fetch('/xapi/activities?activityId=http://example.com/a', {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('http://example.com/a');
    expect(body.objectType).toBe('Activity');
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

describe('GET /xapi/agents', () => {
  apiTest('returns empty Person for unknown agent', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(`/xapi/agents?agent=${agent}`, {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objectType).toBe('Person');
  });

  apiTest('rejects invalid agent JSON', async ({ fetch }) => {
    const res = await fetch('/xapi/agents?agent=not-json', {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Unknown query parameters
// ---------------------------------------------------------------------------

describe('unknown query parameter rejection', () => {
  apiTest('rejects GET /xapi/statements with unknown param', async ({ fetch }) => {
    const res = await fetch('/xapi/statements?foo=bar', { headers: XAPI_HEADERS });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNKNOWN_QUERY_PARAMS');
    expect(body.error.message).toContain('foo');
  });

  apiTest('rejects GET /xapi/about with any query param', async ({ fetch }) => {
    const res = await fetch('/xapi/about?extra=1', {
      headers: { 'X-Experience-API-Version': '1.0.3' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNKNOWN_QUERY_PARAMS');
  });

  apiTest('rejects PUT /xapi/activities/state with unknown param', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1&badParam=x`,
      {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/octet-stream' },
        body: 'data',
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('badParam');
  });

  apiTest('allows GET /xapi/statements with only known params', async ({ fetch }) => {
    const res = await fetch('/xapi/statements?verb=http://example.com/v&limit=5', {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Alternate request syntax (POST ?method=...)
// ---------------------------------------------------------------------------

describe('alternate request syntax', () => {
  apiTest('POST ?method=GET rewrites to GET /xapi/statements', async ({ fetch }) => {
    const params = new URLSearchParams({
      method: 'GET',
      agent: '{"mbox":"mailto:a@b.com"}',
      verb: 'http://example.com/v',
      'X-Experience-API-Version': '1.0.3',
      Authorization: 'Bearer test-token',
    });

    const res = await fetch('/xapi/statements?method=GET', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    // Should hit the GET handler and return 200 with empty StatementResult
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('statements');
  });

  apiTest('POST ?method=PUT rewrites to PUT /xapi/statements', async ({ fetch }) => {
    const stmtId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const stmt = JSON.stringify({
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'http://example.com/verb' },
      object: { id: 'http://example.com/activity' },
    });

    const params = new URLSearchParams({
      method: 'PUT',
      statementId: stmtId,
      'X-Experience-API-Version': '1.0.3',
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      content: stmt,
    });

    const res = await fetch('/xapi/statements?method=PUT', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    expect(res.status).toBe(204);
  });

  apiTest('POST ?method=DELETE rewrites to DELETE /xapi/activities/state', async ({ fetch }) => {
    const params = new URLSearchParams({
      method: 'DELETE',
      activityId: 'http://example.com/activity',
      agent: '{"mbox":"mailto:a@b.com"}',
      'X-Experience-API-Version': '1.0.3',
      Authorization: 'Bearer test-token',
    });

    const res = await fetch('/xapi/activities/state?method=DELETE', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    expect(res.status).toBe(204);
  });

  apiTest('rejects invalid method value', async ({ fetch }) => {
    const params = new URLSearchParams({
      method: 'PATCH',
      'X-Experience-API-Version': '1.0.3',
      Authorization: 'Bearer test-token',
    });

    const res = await fetch('/xapi/statements?method=PATCH', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('PATCH');
  });

  apiTest('promotes header form fields to real headers', async ({ fetch }) => {
    // POST ?method=GET /xapi/about — version header promoted from form body
    const params = new URLSearchParams({
      method: 'GET',
      'X-Experience-API-Version': '1.0.3',
    });

    const res = await fetch('/xapi/about?method=GET', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    // The version middleware should see the promoted header and accept it
    expect(res.status).toBe(200);
    expect(res.headers.get('x-experience-api-version')).toBe('1.0.3');
  });

  apiTest('POST without method param is normal POST (not alternate)', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      method: 'POST',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        actor: { mbox: 'mailto:a@example.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/a' },
      }]),
    });

    // Normal POST should work as before — returns statement ids
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Consistent-Through header (xAPI 1.0.3 §2.1.3)
// ---------------------------------------------------------------------------

describe('X-Experience-API-Consistent-Through header', () => {
  apiTest('GET /xapi/statements includes Consistent-Through header', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', { headers: XAPI_HEADERS });

    expect(res.status).toBe(200);
    const header = res.headers.get('x-experience-api-consistent-through');
    expect(header).toBeDefined();
    // Must be a valid ISO 8601 timestamp
    expect(Number.isNaN(Date.parse(header as string))).toBe(false);
  });

  apiTest('PUT /xapi/statements includes Consistent-Through header', async ({ fetch }) => {
    const stmtId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const res = await fetch(`/xapi/statements?statementId=${stmtId}`, {
      method: 'PUT',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: stmtId,
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      }),
    });

    expect(res.status).toBe(204);
    const header = res.headers.get('x-experience-api-consistent-through');
    expect(header).toBeDefined();
    expect(Number.isNaN(Date.parse(header as string))).toBe(false);
  });

  apiTest('POST /xapi/statements includes Consistent-Through header', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      method: 'POST',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      }),
    });

    expect(res.status).toBe(200);
    const header = res.headers.get('x-experience-api-consistent-through');
    expect(header).toBeDefined();
    expect(Number.isNaN(Date.parse(header as string))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HEAD method support (xAPI 1.0.3 §2.1)
// Express auto-derives HEAD from GET — verify it actually works.
// ---------------------------------------------------------------------------

describe('HEAD method support', () => {
  apiTest('HEAD /xapi/about returns 200 with no body', async ({ fetch }) => {
    const res = await fetch('/xapi/about', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-experience-api-version')).toBe('1.0.3');
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/statements returns 200 with headers but no body', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-experience-api-consistent-through')).toBeDefined();
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/activities/state returns 200 with no body', async ({ fetch }) => {
    const res = await fetch('/xapi/activities/state?activityId=http://example.com/act&agent=%7B%22mbox%22%3A%22mailto%3Atest%40example.com%22%7D', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/activities/profile returns 200 with no body', async ({ fetch }) => {
    const res = await fetch('/xapi/activities/profile?activityId=http://example.com/act', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/agents/profile returns 200 with no body', async ({ fetch }) => {
    const res = await fetch('/xapi/agents/profile?agent=%7B%22mbox%22%3A%22mailto%3Atest%40example.com%22%7D', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/activities returns 200 with no body', async ({ fetch }) => {
    const res = await fetch('/xapi/activities?activityId=http://example.com/act', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/agents returns 200 with no body', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(`/xapi/agents?agent=${agent}`, {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('');
  });

  apiTest('HEAD /xapi/statements rejects unknown query params', async ({ fetch }) => {
    const res = await fetch('/xapi/statements?foo=bar', {
      method: 'HEAD',
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  apiTest('returns 404 for unknown paths', async ({ fetch }) => {
    const res = await fetch('/xapi/nonexistent', { headers: XAPI_HEADERS });

    expect(res.status).toBe(404);
  });
});
