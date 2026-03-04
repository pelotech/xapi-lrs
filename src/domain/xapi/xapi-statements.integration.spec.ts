import { describe, expect, it } from 'vitest';
import { apiTest } from '../../test/api-fixture.js';
import { XAPI_HEADERS, startTestServer, wrapMockPool } from './xapi-test-helpers.js';

// ---------------------------------------------------------------------------
// GET /xapi/statements
// ---------------------------------------------------------------------------

describe('GET /xapi/statements', () => {
  apiTest('returns empty statement result from mock pool', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', { headers: XAPI_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.statements).toEqual([]);
  });

  apiTest('returns 404 for nonexistent statementId', async ({ fetch }) => {
    const res = await fetch('/xapi/statements?statementId=00000000-0000-0000-0000-000000000000', {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(404);
  });

  apiTest('rejects both statementId and voidedStatementId', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/statements?statementId=abc&voidedStatementId=def',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  apiTest('rejects statementId combined with filter params', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/statements?statementId=abc&verb=http://example.com/verb',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
  });

  apiTest('rejects statementId combined with ascending', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/statements?statementId=abc&ascending=true',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
  });

  apiTest('rejects statementId combined with limit', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/statements?statementId=abc&limit=10',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
  });

  apiTest('rejects voidedStatementId combined with cursor', async ({ fetch }) => {
    const res = await fetch(
      '/xapi/statements?voidedStatementId=abc&cursor=somecursor',
      { headers: XAPI_HEADERS },
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /xapi/statements
// ---------------------------------------------------------------------------

describe('PUT /xapi/statements', () => {
  const UUID_1 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const UUID_2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  apiTest('rejects mismatched statement id', async ({ fetch }) => {
    const res = await fetch(`/xapi/statements?statementId=${UUID_1}`, {
      method: 'PUT',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: UUID_2,
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('does not match');
  });

  apiTest('stores a valid statement and returns 204', async ({ fetch }) => {
    const res = await fetch(`/xapi/statements?statementId=${UUID_1}`, {
      method: 'PUT',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: UUID_1,
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      }),
    });

    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /xapi/statements
// ---------------------------------------------------------------------------

describe('POST /xapi/statements', () => {
  const SAME_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';

  apiTest('rejects batch with duplicate ids', async ({ fetch }) => {
    const res = await fetch('/xapi/statements', {
      method: 'POST',
      headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          id: SAME_UUID,
          actor: { mbox: 'mailto:a@example.com' },
          verb: { id: 'http://example.com/v' },
          object: { id: 'http://example.com/a' },
        },
        {
          id: SAME_UUID,
          actor: { mbox: 'mailto:b@example.com' },
          verb: { id: 'http://example.com/v' },
          object: { id: 'http://example.com/b' },
        },
      ]),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('duplicate');
  });

  apiTest('stores a valid single statement and returns ids', async ({ fetch }) => {
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
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(typeof body[0]).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Statement voiding (integration)
// ---------------------------------------------------------------------------

describe('statement voiding', () => {
  const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const VOIDING_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const VOIDING_VERB = 'http://adlnet.gov/expapi/verbs/voided';

  function voidingMockPool() {
    const rows = new Map<string, { raw: Record<string, unknown>; voided: boolean; verb_id: string }>();

    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : undefined;

      if (name === 'xapi_stmt_insert') {
        const id = values?.[0] as string;
        const verbId = values?.[1] as string;
        const rawJson = values?.[6] as string;
        rows.set(id, { raw: JSON.parse(rawJson), voided: false, verb_id: verbId });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (name === 'xapi_stmt_void_target') {
        const id = values?.[0] as string;
        const row = rows.get(id);
        // Mirror the SQL: voided = FALSE AND verb_id != voided verb
        if (row && !row.voided && row.verb_id !== VOIDING_VERB) {
          row.voided = true;
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      if (name === 'xapi_stmt_get') {
        const id = values?.[0] as string;
        const row = rows.get(id);
        if (row && !row.voided) {
          return Promise.resolve({ rows: [{ raw: row.raw }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      if (name === 'xapi_stmt_get_voided') {
        const id = values?.[0] as string;
        const row = rows.get(id);
        if (row && row.voided) {
          return Promise.resolve({ rows: [{ raw: row.raw }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
      }

      // queryStatements (dynamic SQL, no name) — return non-voided rows
      if (typeof sqlOrConfig === 'string' || (typeof sqlOrConfig === 'object' && !sqlOrConfig.name)) {
        const nonVoided = [...rows.values()].filter((r) => !r.voided).map((r) => ({ raw: r.raw }));
        return Promise.resolve({ rows: nonVoided, rowCount: nonVoided.length });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return wrapMockPool(queryFn);
  }

  it('voiding statement marks target as voided', async () => {
    const pool = voidingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements?statementId=${TARGET_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: TARGET_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/did' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: VOIDING_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: VOIDING_VERB },
          object: { objectType: 'StatementRef', id: TARGET_ID },
        }),
      });

      const getTarget = await fetch(`${baseUrl}/xapi/statements?statementId=${TARGET_ID}`, {
        headers: XAPI_HEADERS,
      });
      expect(getTarget.status).toBe(404);

      const getVoided = await fetch(`${baseUrl}/xapi/statements?voidedStatementId=${TARGET_ID}`, {
        headers: XAPI_HEADERS,
      });
      expect(getVoided.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('voiding statement itself is still returned normally', async () => {
    const pool = voidingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements?statementId=${TARGET_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: TARGET_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/did' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: VOIDING_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: VOIDING_VERB },
          object: { objectType: 'StatementRef', id: TARGET_ID },
        }),
      });

      const res = await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('voided statement excluded from multi-statement queries', async () => {
    const pool = voidingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements?statementId=${TARGET_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: TARGET_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/did' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: VOIDING_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: VOIDING_VERB },
          object: { objectType: 'StatementRef', id: TARGET_ID },
        }),
      });

      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { statements: Array<{ id: string }> };
      const ids = body.statements.map((s) => s.id);
      expect(ids).not.toContain(TARGET_ID);
      expect(ids).toContain(VOIDING_ID);
    } finally {
      await close();
    }
  });

  it('cannot void a voiding statement', async () => {
    const pool = voidingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements?statementId=${TARGET_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: TARGET_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/did' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: VOIDING_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: VOIDING_VERB },
          object: { objectType: 'StatementRef', id: TARGET_ID },
        }),
      });

      const voidVoidId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
      await fetch(`${baseUrl}/xapi/statements?statementId=${voidVoidId}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: voidVoidId,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: VOIDING_VERB },
          object: { objectType: 'StatementRef', id: VOIDING_ID },
        }),
      });

      const res = await fetch(`${baseUrl}/xapi/statements?statementId=${VOIDING_ID}`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Statement conflict detection (§2.4.1.1)
// ---------------------------------------------------------------------------

describe('statement conflict detection', () => {
  const STMT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function conflictMockPool() {
    const stored = new Map<string, string>(); // id → raw JSON string

    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : undefined;

      if (name === 'xapi_stmt_insert') {
        const id = values?.[0] as string;
        const rawJson = values?.[6] as string;
        if (stored.has(id)) {
          return Promise.resolve({ rows: [], rowCount: 0 }); // ON CONFLICT DO NOTHING
        }
        stored.set(id, rawJson);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (name === 'xapi_stmt_get_raw') {
        const id = values?.[0] as string;
        const raw = stored.get(id);
        if (raw) return Promise.resolve({ rows: [{ raw: JSON.parse(raw) }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    };

    return wrapMockPool(queryFn);
  }

  it('PUT same statement twice returns 204 (idempotent)', async () => {
    const pool = conflictMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const body = JSON.stringify({
        id: STMT_ID,
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      });

      const res1 = await fetch(`${baseUrl}/xapi/statements?statementId=${STMT_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body,
      });
      expect(res1.status).toBe(204);

      const res2 = await fetch(`${baseUrl}/xapi/statements?statementId=${STMT_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body,
      });
      expect(res2.status).toBe(204);
    } finally {
      await close();
    }
  });

  it('PUT same id with different content returns 409', async () => {
    const pool = conflictMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements?statementId=${STMT_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: STMT_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/verb' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      const res2 = await fetch(`${baseUrl}/xapi/statements?statementId=${STMT_ID}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: STMT_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/DIFFERENT-verb' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      expect(res2.status).toBe(409);
      const body = await res2.json();
      expect(body.error.message).toContain('already exists with different content');
    } finally {
      await close();
    }
  });

  it('POST same statement twice returns 200 (idempotent)', async () => {
    const pool = conflictMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const stmt = {
        id: STMT_ID,
        actor: { mbox: 'mailto:test@example.com' },
        verb: { id: 'http://example.com/verb' },
        object: { id: 'http://example.com/activity' },
      };

      const res1 = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(stmt),
      });
      expect(res1.status).toBe(200);

      const res2 = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(stmt),
      });
      expect(res2.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('POST with conflicting stored id returns 409', async () => {
    const pool = conflictMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: STMT_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/verb' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      const res2 = await fetch(`${baseUrl}/xapi/statements`, {
        method: 'POST',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: STMT_ID,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/DIFFERENT-verb' },
          object: { id: 'http://example.com/activity' },
        }),
      });

      expect(res2.status).toBe(409);
      const body = await res2.json();
      expect(body.error.message).toContain('already exists with different content');
    } finally {
      await close();
    }
  });
});
