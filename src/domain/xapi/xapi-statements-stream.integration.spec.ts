import { describe, expect, it } from 'vitest';
import { XAPI_HEADERS, startTestServer, wrapMockPool } from './xapi-test-helpers.js';

/**
 * Parse SSE text into an array of {event, data} pairs.
 */
function parseSSE(text: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  let event = '';
  let data = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    } else if (line === '') {
      if (event || data) {
        events.push({ event, data });
        event = '';
        data = '';
      }
    }
  }

  return events;
}

describe('GET /xapi/statements/stream (SSE)', () => {
  function sseQueryMockPool() {
    const sampleStatements = [
      {
        raw: {
          id: 'stmt-1',
          actor: { mbox: 'mailto:a@b.com' },
          verb: { id: 'http://example.com/verb' },
          object: { id: 'http://example.com/activity' },
          stored: '2024-01-01T00:00:00.000Z',
        },
        stored: '2024-01-01T00:00:00.000Z',
        id: 'stmt-1',
      },
      {
        raw: {
          id: 'stmt-2',
          actor: { mbox: 'mailto:a@b.com' },
          verb: { id: 'http://example.com/verb' },
          object: { id: 'http://example.com/activity' },
          stored: '2024-01-01T01:00:00.000Z',
        },
        stored: '2024-01-01T01:00:00.000Z',
        id: 'stmt-2',
      },
    ];

    const pool = wrapMockPool((sqlOrConfig) => {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';

      // Catch-up query
      if (sql.includes('SELECT raw, stored, id FROM xapi.statements')) {
        return Promise.resolve({ rows: sampleStatements, rowCount: sampleStatements.length });
      }

      // Auth: return empty for scopes lookup (falls through to JWT auth)
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    return { pool, sampleStatements };
  }

  it('returns SSE headers', async () => {
    const { pool } = sseQueryMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${baseUrl}/xapi/statements/stream`, {
        headers: XAPI_HEADERS,
        signal: controller.signal,
      }).catch((e) => e);

      // The response should start streaming immediately
      // For SSE, we need to check headers before body completes
      if (res instanceof Response) {
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        expect(res.headers.get('cache-control')).toBe('no-cache');
        expect(res.headers.get('x-experience-api-version')).toBe('1.0.3');
        expect(res.headers.has('content-length')).toBe(false);
        controller.abort();
      }

      clearTimeout(timeout);
    } finally {
      await close();
    }
  });

  it('returns 401 without auth', async () => {
    const { pool } = sseQueryMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements/stream`, {
        headers: { 'X-Experience-API-Version': '1.0.3' },
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns 400 for missing X-Experience-API-Version header', async () => {
    const { pool } = sseQueryMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements/stream`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('rejects unknown query params with 400', async () => {
    const { pool } = sseQueryMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements/stream?unknownParam=foo`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNKNOWN_QUERY_PARAMS');
    } finally {
      await close();
    }
  });

  it('streams existing statements then sends caught-up', async () => {
    const { sampleStatements } = sseQueryMockPool();
    // After first batch, return empty to end catch-up
    let callCount = 0;
    const pool2 = wrapMockPool((sqlOrConfig) => {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';
      if (sql.includes('SELECT raw, stored, id FROM xapi.statements')) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ rows: sampleStatements, rowCount: sampleStatements.length });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { ready, close } = startTestServer(pool2);
    const baseUrl = await ready;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      let text = '';
      try {
        const res = await fetch(`${baseUrl}/xapi/statements/stream`, {
          headers: XAPI_HEADERS,
          signal: controller.signal,
        });

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        // Read until we get the caught-up event
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.includes('event: caught-up')) {
            controller.abort();
            break;
          }
        }
      } catch {
        // AbortError expected
      }

      clearTimeout(timeout);

      const events = parseSSE(text);
      const stmtEvents = events.filter((e) => e.event === 'statement');
      const caughtUpEvents = events.filter((e) => e.event === 'caught-up');

      expect(stmtEvents).toHaveLength(2);
      expect(JSON.parse(stmtEvents[0]!.data)).toHaveProperty('id', 'stmt-1');
      expect(JSON.parse(stmtEvents[1]!.data)).toHaveProperty('id', 'stmt-2');
      expect(caughtUpEvents).toHaveLength(1);
      expect(JSON.parse(caughtUpEvents[0]!.data)).toHaveProperty('stored');
    } finally {
      await close();
    }
  });
});
