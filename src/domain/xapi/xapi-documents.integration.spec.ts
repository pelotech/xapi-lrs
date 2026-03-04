import { describe, expect, it } from 'vitest';
import { apiTest } from '../../test/api-fixture.js';
import { XAPI_HEADERS, docMockPool, startTestServer } from './xapi-test-helpers.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

describe('GET /xapi/activities/state', () => {
  apiTest('returns 404 for nonexistent state document', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(404);
  });

  apiTest('returns empty list without stateId', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}`,
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  apiTest('rejects invalid agent JSON', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/activities/state?activityId=http://example.com/a&agent=not-json&stateId=s1',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid JSON');
  });
});

// ---------------------------------------------------------------------------
// State concurrency
// ---------------------------------------------------------------------------

describe('State concurrency', () => {
  apiTest('PUT without concurrency headers succeeds (state is relaxed)', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
      {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: '{"key":"value"}',
      },
    );

    expect(res.status).toBe(204);
  });

  apiTest('POST without concurrency headers succeeds', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
      {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: '{"key":"value"}',
      },
    );

    expect(res.status).toBe(204);
  });

  it('PUT returns 412 when If-Match does not match existing ETag', async () => {
    const existingEtag = '"abc123"';
    const pool = docMockPool({
      xapi_state_get: { content: Buffer.from('old'), content_type: 'application/json', etag: existingEtag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': '"wrong-etag"' },
          body: '{"new":"data"}',
        },
      );

      expect(res.status).toBe(412);
      const body = await res.json();
      expect(body.error.code).toBe('PRECONDITION_FAILED');
    } finally {
      await close();
    }
  });

  it('PUT succeeds when If-Match matches existing ETag', async () => {
    const existingEtag = '"abc123"';
    const pool = docMockPool({
      xapi_state_get: { content: Buffer.from('old'), content_type: 'application/json', etag: existingEtag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': existingEtag },
          body: '{"new":"data"}',
        },
      );

      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('PUT returns 412 when If-None-Match is * and document exists', async () => {
    const pool = docMockPool({
      xapi_state_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"exists"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{"new":"data"}',
        },
      );

      expect(res.status).toBe(412);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Activity Profile
// ---------------------------------------------------------------------------

describe('PUT /xapi/activities/profile', () => {
  apiTest('rejects PUT without concurrency headers (400 Bad Request)', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/activities/profile?activityId=http://example.com/a&profileId=p1',
      {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  apiTest('accepts PUT with If-None-Match header and returns 204', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/activities/profile?activityId=http://example.com/a&profileId=p1',
      {
        method: 'PUT',
        headers: {
          ...XAPI_HEADERS,
          'Content-Type': 'application/json',
          'If-None-Match': '*',
        },
        body: '{}',
      },
    );

    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Activity Profile concurrency
// ---------------------------------------------------------------------------

describe('Activity Profile concurrency', () => {
  it('PUT returns 409 when resource exists and no ETag headers', async () => {
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"existing"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
          body: '{"updated":true}',
        },
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
    } finally {
      await close();
    }
  });

  it('PUT returns 412 when If-Match does not match', async () => {
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"real-etag"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': '"wrong-etag"' },
          body: '{"updated":true}',
        },
      );

      expect(res.status).toBe(412);
      const body = await res.json();
      expect(body.error.code).toBe('PRECONDITION_FAILED');
    } finally {
      await close();
    }
  });

  it('PUT succeeds when If-Match matches', async () => {
    const etag = '"real-etag"';
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('old'), content_type: 'application/json', etag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': etag },
          body: '{"updated":true}',
        },
      );

      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('PUT returns 412 when If-None-Match is * and document exists', async () => {
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"exists"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{"new":true}',
        },
      );

      expect(res.status).toBe(412);
      const body = await res.json();
      expect(body.error.code).toBe('PRECONDITION_FAILED');
    } finally {
      await close();
    }
  });

  it('POST returns 412 when If-Match does not match', async () => {
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('{"old":true}'), content_type: 'application/json', etag: '"real-etag"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'POST',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': '"wrong"' },
          body: '{"merged":true}',
        },
      );

      expect(res.status).toBe(412);
    } finally {
      await close();
    }
  });

  it('DELETE returns 412 when If-Match does not match', async () => {
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"real-etag"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        {
          method: 'DELETE',
          headers: { ...XAPI_HEADERS, 'If-Match': '"wrong"' },
        },
      );

      expect(res.status).toBe(412);
    } finally {
      await close();
    }
  });

  it('GET returns ETag header for existing document', async () => {
    const etag = '"doc-etag-123"';
    const pool = docMockPool({
      xapi_ap_get: { content: Buffer.from('{"data":1}'), content_type: 'application/json', etag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/activities/profile?activityId=http://example.com/a&profileId=p1`,
        { headers: XAPI_HEADERS },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(etag);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Agent Profile
// ---------------------------------------------------------------------------

describe('PUT /xapi/agents/profile', () => {
  apiTest('rejects PUT without concurrency headers (400 Bad Request)', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/agents/profile?agent=${agent}&profileId=p1`,
      {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Agent Profile concurrency
// ---------------------------------------------------------------------------

describe('Agent Profile concurrency', () => {
  it('PUT returns 409 when resource exists and no ETag headers', async () => {
    const pool = docMockPool({
      xapi_agp_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"existing"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
          body: '{}',
        },
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('CONFLICT');
    } finally {
      await close();
    }
  });

  it('PUT returns 412 when If-Match does not match', async () => {
    const pool = docMockPool({
      xapi_agp_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"real-etag"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': '"wrong"' },
          body: '{}',
        },
      );

      expect(res.status).toBe(412);
      const body = await res.json();
      expect(body.error.code).toBe('PRECONDITION_FAILED');
    } finally {
      await close();
    }
  });

  it('PUT succeeds when If-Match matches', async () => {
    const etag = '"agent-etag"';
    const pool = docMockPool({
      xapi_agp_get: { content: Buffer.from('old'), content_type: 'application/json', etag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-Match': etag },
          body: '{}',
        },
      );

      expect(res.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('PUT returns 412 when If-None-Match is * and document exists', async () => {
    const pool = docMockPool({
      xapi_agp_get: { content: Buffer.from('old'), content_type: 'application/json', etag: '"exists"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        {
          method: 'PUT',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json', 'If-None-Match': '*' },
          body: '{}',
        },
      );

      expect(res.status).toBe(412);
    } finally {
      await close();
    }
  });

  it('GET returns ETag header for existing document', async () => {
    const etag = '"agp-etag-456"';
    const pool = docMockPool({
      xapi_agp_get: { content: Buffer.from('{"agent":"data"}'), content_type: 'application/json', etag, updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/agents/profile?agent=${agent}&profileId=p1`,
        { headers: XAPI_HEADERS },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(etag);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Document merge content-type validation (xAPI 1.0.3 §2.2)
// ---------------------------------------------------------------------------

describe('Document merge rejects non-JSON', () => {
  apiTest('POST /xapi/activities/state returns 400 for non-JSON content-type', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
      {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/octet-stream' },
        body: 'binary-data',
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('application/json');
  });

  apiTest('POST /xapi/activities/profile returns 400 for non-JSON content-type', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/activities/profile?activityId=http://example.com/a&profileId=p1',
      {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'text/plain' },
        body: 'hello',
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('application/json');
  });

  apiTest('POST /xapi/agents/profile returns 400 for non-JSON content-type', async ({ fetch }) => {
    const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
    const res = await fetch(
      `/xapi/agents/profile?agent=${agent}&profileId=p1`,
      {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/octet-stream' },
        body: 'binary',
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('application/json');
  });

  it('POST /xapi/activities/state returns 400 when existing doc is not JSON', async () => {
    const pool = docMockPool({
      xapi_state_get: { content: Buffer.from('binary'), content_type: 'application/octet-stream', etag: '"old"', updated_at: new Date() },
    });
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const agent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:t@example.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/activities/state?activityId=http://example.com/a&agent=${agent}&stateId=s1`,
        {
          method: 'POST',
          headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
          body: '{"new":"data"}',
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('existing document');
    } finally {
      await close();
    }
  });
});
