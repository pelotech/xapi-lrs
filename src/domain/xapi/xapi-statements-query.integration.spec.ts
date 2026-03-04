import { describe, expect, it } from 'vitest';
import { apiTest } from '../../test/api-fixture.js';
import { encodeCursor } from './pg-xapi.queries.js';
import { XAPI_HEADERS, startTestServer, wrapMockPool } from './xapi-test-helpers.js';

describe('related_activities and related_agents filtering', () => {
  function capturingMockPool() {
    const captured: { sql: string; values: unknown[] }[] = [];
    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }, maybeValues?: unknown[]) => {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';
      const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : maybeValues;
      if (sql.includes('SELECT raw, stored, id')) {
        captured.push({ sql, values: values as unknown[] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    };
    return { pool: wrapMockPool(queryFn), captured };
  }

  it('related_activities=true generates JSONB containment SQL', async () => {
    const { pool, captured } = capturingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/statements?activity=${encodeURIComponent('http://example.com/a')}&related_activities=true`,
        { headers: XAPI_HEADERS },
      );
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const sql = captured[0]?.sql ?? '';
      expect(sql).toContain('@>');
      expect(sql).toContain('contextActivities');
      expect(sql).toContain('SubStatement');
      expect(captured[0]?.values).toContain('[{"id":"http://example.com/a"}]');
    } finally {
      await close();
    }
  });

  it('related_activities=false uses simple activity_id filter', async () => {
    const { pool, captured } = capturingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/statements?activity=${encodeURIComponent('http://example.com/a')}`,
        { headers: XAPI_HEADERS },
      );
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const sql = captured[0]?.sql ?? '';
      expect(sql).toContain('activity_id =');
      expect(sql).not.toContain('@>');
    } finally {
      await close();
    }
  });

  it('related_agents=true generates JSONB containment SQL', async () => {
    const { pool, captured } = capturingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const searchAgent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:a@b.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/statements?agent=${searchAgent}&related_agents=true`,
        { headers: XAPI_HEADERS },
      );
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const sql = captured[0]?.sql ?? '';
      expect(sql).toContain('@>');
      expect(sql).toContain('authority');
      expect(sql).toContain('instructor');
      expect(sql).toContain('team');
      expect(captured[0]?.values).toContain('{"mbox":"mailto:a@b.com"}');
    } finally {
      await close();
    }
  });

  it('related_agents=false uses simple actor_ifi filter', async () => {
    const { pool, captured } = capturingMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const searchAgent = encodeURIComponent(JSON.stringify({ mbox: 'mailto:a@b.com' }));
      const res = await fetch(
        `${baseUrl}/xapi/statements?agent=${searchAgent}`,
        { headers: XAPI_HEADERS },
      );
      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const sql = captured[0]?.sql ?? '';
      expect(sql).toContain('actor_ifi =');
      expect(sql).not.toContain('@>');
    } finally {
      await close();
    }
  });
});

describe('activity merging on store', () => {
  function activityMergeMockPool() {
    const activities = new Map<string, Record<string, unknown>>();
    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const values = typeof sqlOrConfig === 'object' ? sqlOrConfig.values : undefined;

      if (name === 'xapi_activity_upsert') {
        const id = values?.[0] as string;
        const defJson = values?.[1] as string | null;
        const def = defJson ? JSON.parse(defJson) : {};
        const existing = activities.get(id) ?? {};
        activities.set(id, { ...existing, ...def });
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (name === 'xapi_activity_get') {
        const id = values?.[0] as string;
        const def = activities.get(id);
        if (def) return Promise.resolve({ rows: [{ id, definition: def }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      if (name === 'xapi_stmt_insert') {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: new Date().toISOString() }], rowCount: 1 });
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    };
    return { pool: wrapMockPool(queryFn), activities };
  }

  it('stores contextActivities into the activities table', async () => {
    const { pool } = activityMergeMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const stmtId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      await fetch(`${baseUrl}/xapi/statements?statementId=${stmtId}`, {
        method: 'PUT',
        headers: { ...XAPI_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: stmtId,
          actor: { mbox: 'mailto:test@example.com' },
          verb: { id: 'http://example.com/did' },
          object: { id: 'http://example.com/act', definition: { name: { en: 'Top' } } },
          context: {
            contextActivities: {
              parent: [{ id: 'http://example.com/parent', definition: { name: { en: 'Parent' } } }],
            },
          },
        }),
      });

      // Both top-level and parent activity should be available
      const topRes = await fetch(`${baseUrl}/xapi/activities?activityId=${encodeURIComponent('http://example.com/act')}`, {
        headers: XAPI_HEADERS,
      });
      expect(topRes.status).toBe(200);
      const topBody = await topRes.json() as { id: string; definition?: Record<string, unknown> };
      expect(topBody.definition?.name).toEqual({ en: 'Top' });

      const parentRes = await fetch(`${baseUrl}/xapi/activities?activityId=${encodeURIComponent('http://example.com/parent')}`, {
        headers: XAPI_HEADERS,
      });
      expect(parentRes.status).toBe(200);
      const parentBody = await parentRes.json() as { id: string; definition?: Record<string, unknown> };
      expect(parentBody.definition?.name).toEqual({ en: 'Parent' });
    } finally {
      await close();
    }
  });
});

describe('format=canonical with activities table', () => {
  function canonicalMockPool() {
    const STMT_RAW = {
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      actor: { mbox: 'mailto:a@example.com' },
      verb: { id: 'http://example.com/v', display: { en: 'did' } },
      object: {
        objectType: 'Activity',
        id: 'http://example.com/act',
        definition: { name: { en: 'Embedded' } },
      },
      stored: '2025-06-01T00:00:00.000Z',
      timestamp: '2025-06-01T00:00:00.000Z',
    };

    const CANONICAL_DEF = { name: { en: 'Canonical', fr: 'Canonique' }, type: 'http://example.com/type' };

    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;
      const text = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';

      if (name === 'xapi_stmt_get') {
        return Promise.resolve({ rows: [{ raw: STMT_RAW }], rowCount: 1 });
      }
      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: '2025-06-01T00:00:00.000Z' }], rowCount: 1 });
      }
      // getActivitiesBatch — dynamic SQL with ANY($1)
      if (text.includes('ANY($1)')) {
        return Promise.resolve({
          rows: [{ id: 'http://example.com/act', definition: CANONICAL_DEF }],
          rowCount: 1,
        });
      }
      // queryStatements (dynamic SQL)
      if (typeof sqlOrConfig === 'string' || (typeof sqlOrConfig === 'object' && !sqlOrConfig.name)) {
        return Promise.resolve({
          rows: [{ raw: STMT_RAW, stored: STMT_RAW.stored, id: STMT_RAW.id }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    };
    return wrapMockPool(queryFn);
  }

  it('format=canonical uses canonical definition from activities table', async () => {
    const pool = canonicalMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements?format=canonical`, {
        headers: { ...XAPI_HEADERS, 'Accept-Language': 'fr' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { statements: Array<Record<string, unknown>> };
      const stmt = body.statements[0]!;
      const def = (stmt.object as { definition: Record<string, unknown> }).definition;
      // Should have canonical definition with language filtering applied
      expect(def.name).toEqual({ fr: 'Canonique' });
      expect(def.type).toBe('http://example.com/type');
    } finally {
      await close();
    }
  });

  it('format=canonical uses canonical def for single-statement GET', async () => {
    const pool = canonicalMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/statements?statementId=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa&format=canonical`,
        { headers: { ...XAPI_HEADERS, 'Accept-Language': 'en' } },
      );
      expect(res.status).toBe(200);
      const stmt = await res.json() as Record<string, unknown>;
      const def = (stmt.object as { definition: Record<string, unknown> }).definition;
      expect(def.name).toEqual({ en: 'Canonical' });
      expect(def.type).toBe('http://example.com/type');
    } finally {
      await close();
    }
  });
});

describe('GET /xapi/statements format parameter', () => {
  const STMT_RAW = {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    actor: { objectType: 'Agent', name: 'Alice', mbox: 'mailto:alice@example.com' },
    verb: { id: 'http://example.com/did', display: { 'en-US': 'did', fr: 'a fait' } },
    object: {
      objectType: 'Activity',
      id: 'http://example.com/act',
      definition: { name: { 'en-US': 'Test', fr: 'Test' }, description: { 'en-US': 'A test' } },
    },
    stored: '2025-06-01T00:00:00.000Z',
    timestamp: '2025-06-01T00:00:00.000Z',
  };

  function formatMockPool() {
    const queryFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      const name = typeof sqlOrConfig === 'object' ? sqlOrConfig.name : undefined;

      if (name === 'xapi_stmt_get') {
        return Promise.resolve({ rows: [{ raw: STMT_RAW }], rowCount: 1 });
      }
      if (name === 'xapi_stmt_consistent_through') {
        return Promise.resolve({ rows: [{ max_stored: '2025-06-01T00:00:00.000Z' }], rowCount: 1 });
      }
      // queryStatements (dynamic SQL)
      if (typeof sqlOrConfig === 'string' || (typeof sqlOrConfig === 'object' && !sqlOrConfig.name)) {
        return Promise.resolve({
          rows: [{ raw: STMT_RAW, stored: STMT_RAW.stored, id: STMT_RAW.id }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    };
    return wrapMockPool(queryFn);
  }

  it('format=ids strips definition and display from multi-statement query', async () => {
    const pool = formatMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements?format=ids`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { statements: Array<Record<string, unknown>> };
      const stmt = body.statements[0]!;
      expect((stmt.verb as { display?: unknown }).display).toBeUndefined();
      expect((stmt.object as { definition?: unknown }).definition).toBeUndefined();
      expect((stmt.actor as { name?: unknown }).name).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('format=ids strips definition from single-statement GET', async () => {
    const pool = formatMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(
        `${baseUrl}/xapi/statements?statementId=${STMT_RAW.id}&format=ids`,
        { headers: XAPI_HEADERS },
      );
      expect(res.status).toBe(200);
      const stmt = await res.json() as Record<string, unknown>;
      expect((stmt.verb as { display?: unknown }).display).toBeUndefined();
      expect((stmt.object as { definition?: unknown }).definition).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('format=canonical filters LanguageMaps per Accept-Language', async () => {
    const pool = formatMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements?format=canonical`, {
        headers: { ...XAPI_HEADERS, 'Accept-Language': 'fr' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { statements: Array<Record<string, unknown>> };
      const stmt = body.statements[0]!;
      expect(stmt.verb).toEqual({ id: 'http://example.com/did', display: { fr: 'a fait' } });
      const def = (stmt.object as { definition: Record<string, unknown> }).definition;
      expect(def.name).toEqual({ fr: 'Test' });
    } finally {
      await close();
    }
  });

  it('format=exact (default) returns statement unchanged', async () => {
    const pool = formatMockPool();
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements`, {
        headers: XAPI_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { statements: Array<Record<string, unknown>> };
      const stmt = body.statements[0]!;
      // Should have both languages in display
      expect((stmt.verb as { display: Record<string, string> }).display).toEqual({ 'en-US': 'did', fr: 'a fait' });
      // Should have full definition
      const def = (stmt.object as { definition: Record<string, unknown> }).definition;
      expect(def.name).toEqual({ 'en-US': 'Test', fr: 'Test' });
    } finally {
      await close();
    }
  });
});

describe('GET /xapi/statements cursor pagination', () => {
  const STMT_A = {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    actor: { mbox: 'mailto:a@example.com' },
    verb: { id: 'http://example.com/v' },
    object: { id: 'http://example.com/act' },
  };
  const STMT_B = {
    id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    actor: { mbox: 'mailto:b@example.com' },
    verb: { id: 'http://example.com/v' },
    object: { id: 'http://example.com/act' },
  };

  function cursorMockPool(queryFn: (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount: number }) {
    const qFn = (sqlOrConfig: string | { name?: string; text?: string; values?: unknown[] }) => {
      if (typeof sqlOrConfig === 'object' && sqlOrConfig.name) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text ?? '';
      // Only dispatch SELECT statements for statement data to the test callback;
      // transaction control (BEGIN/COMMIT) and auth setup (as_user_oidc) get empty results.
      if (!sql.includes('SELECT raw, stored, id')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve(queryFn(sql));
    };
    return wrapMockPool(qFn);
  }

  apiTest('returns 400 for invalid cursor', async ({ fetch }) => {
    const res = await fetch('/xapi/statements?cursor=not-valid-base64', {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Invalid cursor');
  });

  apiTest('returns 400 for cursor with missing fields', async ({ fetch }) => {
    const badCursor = Buffer.from(JSON.stringify({ stored: '2025-01-01T00:00:00.000Z' })).toString('base64url');
    const res = await fetch(`/xapi/statements?cursor=${badCursor}`, {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  apiTest('accepts a valid cursor and returns 200', async ({ fetch }) => {
    const cursor = encodeCursor('2025-06-01T00:00:00.000Z', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    const res = await fetch(`/xapi/statements?cursor=${cursor}`, {
      headers: XAPI_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.statements).toEqual([]);
    expect(body.more).toBeUndefined();
  });

  it('returns more URL when page has more results', async () => {
    const rows = [
      { raw: STMT_B, stored: '2025-06-02T00:00:00.000Z', id: STMT_B.id },
      { raw: STMT_A, stored: '2025-06-01T00:00:00.000Z', id: STMT_A.id },
    ];
    const pool = cursorMockPool(() => ({ rows, rowCount: rows.length }));
    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res = await fetch(`${baseUrl}/xapi/statements?limit=1`, {
        headers: XAPI_HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.statements).toHaveLength(1);
      expect(body.more).toBeDefined();
      expect(body.more).toContain('cursor=');
    } finally {
      await close();
    }
  });

  it('follows more URL to fetch the next page', async () => {
    let callCount = 0;
    const pool = cursorMockPool(() => {
      callCount++;
      if (callCount === 1) {
        return {
          rows: [
            { raw: STMT_B, stored: '2025-06-02T00:00:00.000Z', id: STMT_B.id },
            { raw: STMT_A, stored: '2025-06-01T00:00:00.000Z', id: STMT_A.id },
          ],
          rowCount: 2,
        };
      }
      return {
        rows: [{ raw: STMT_A, stored: '2025-06-01T00:00:00.000Z', id: STMT_A.id }],
        rowCount: 1,
      };
    });

    const { ready, close } = startTestServer(pool);
    const baseUrl = await ready;
    try {
      const res1 = await fetch(`${baseUrl}/xapi/statements?limit=1`, {
        headers: XAPI_HEADERS,
      });

      expect(res1.status).toBe(200);
      const page1 = await res1.json();
      expect(page1.statements).toHaveLength(1);
      expect(page1.more).toBeDefined();

      // Follow the more URL (now an absolute IRL per §2.1.3)
      const res2 = await fetch(page1.more as string, {
        headers: XAPI_HEADERS,
      });

      expect(res2.status).toBe(200);
      const page2 = await res2.json();
      expect(page2.statements).toHaveLength(1);
      expect(page2.more).toBeUndefined();
    } finally {
      await close();
    }
  });
});
