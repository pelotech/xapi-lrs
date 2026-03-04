import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import * as Q from './pg-xapi.queries.js';
import type { Statement } from './types.js';

interface QueryCall {
  text?: string;
  name?: string;
  values?: unknown[];
}

function mockPool(rows: unknown[] = []): pg.Pool & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const queryFn = vi.fn((...args: unknown[]) => {
    if (typeof args[0] === 'string') {
      calls.push({ text: args[0] as string, values: args[1] as unknown[] });
    } else {
      const config = args[0] as QueryCall;
      calls.push({ text: config.text, name: config.name, values: config.values });
    }
    return Promise.resolve({ rows, rowCount: rows.length || 1 });
  });
  return { calls, query: queryFn } as unknown as pg.Pool & { calls: QueryCall[] };
}

function makeStatement(overrides: Partial<Statement> = {}): Statement {
  return {
    actor: { mbox: 'mailto:test@example.com' },
    verb: { id: 'http://example.com/verb' },
    object: { id: 'http://example.com/activity' },
    ...overrides,
  };
}

function findCall(pool: pg.Pool & { calls: QueryCall[] }, name: string): QueryCall | undefined {
  return pool.calls.find((c) => c.name === name);
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips stored and id', () => {
    const cursor = Q.encodeCursor('2024-06-15T12:00:00Z', 'abc-123');
    const decoded = Q.decodeCursor(cursor);
    expect(decoded.stored).toBe('2024-06-15T12:00:00Z');
    expect(decoded.id).toBe('abc-123');
  });

  it('produces a base64url string (no padding, no + or /)', () => {
    const cursor = Q.encodeCursor('2024-01-01T00:00:00Z', 'id-with-dashes');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('throws on invalid cursor JSON', () => {
    const bad = Buffer.from('not-json').toString('base64url');
    expect(() => Q.decodeCursor(bad)).toThrow();
  });

  it('throws on cursor missing stored field', () => {
    const bad = Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url');
    expect(() => Q.decodeCursor(bad)).toThrow('Invalid cursor');
  });

  it('throws on cursor missing id field', () => {
    const bad = Buffer.from(JSON.stringify({ stored: 'x' })).toString('base64url');
    expect(() => Q.decodeCursor(bad)).toThrow('Invalid cursor');
  });
});

describe('storeStatements', () => {
  it('assigns UUID when statement has no id', async () => {
    const pool = mockPool();
    const ids = await Q.storeStatements(pool, [makeStatement()]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves statement id when provided', async () => {
    const pool = mockPool();
    const ids = await Q.storeStatements(pool, [makeStatement({ id: 'my-id' })]);
    expect(ids).toEqual(['my-id']);
  });

  it('calls INSERT with named query xapi_stmt_insert', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'stmt-1' })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    expect(insert).toBeDefined();
    expect(insert?.values?.[0]).toBe('stmt-1');
  });

  it('extracts activity id from Activity object', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'x', object: { id: 'http://act/1' } })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    expect(insert?.values?.[3]).toBe('http://act/1');
  });

  it('returns null activity id for StatementRef objects', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      object: { objectType: 'StatementRef', id: 'ref-id' },
    })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    expect(insert?.values?.[3]).toBeNull();
  });

  it('issues void UPDATE when verb is voided and object is StatementRef', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
      object: { objectType: 'StatementRef', id: 'target-stmt-id' },
    })]);
    const voidCall = pool.calls.find((c) => c.name === 'xapi_stmt_void_target');
    expect(voidCall).toBeDefined();
    expect(voidCall?.values).toEqual(['target-stmt-id']);
  });

  it('does not void when verb is voided but object is Activity', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
      object: { id: 'http://example.com/activity' },
    })]);
    const voidCall = pool.calls.find((c) => c.name === 'xapi_stmt_void_target');
    expect(voidCall).toBeUndefined();
  });

  it('void UPDATE SQL excludes voiding statements from being voided', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      verb: { id: 'http://adlnet.gov/expapi/verbs/voided' },
      object: { objectType: 'StatementRef', id: 'target-voiding-stmt' },
    })]);
    const voidCall = pool.calls.find((c) => c.name === 'xapi_stmt_void_target');
    expect(voidCall).toBeDefined();
    expect(voidCall?.text).toContain("verb_id != 'http://adlnet.gov/expapi/verbs/voided'");
  });

  it('sets stored and version in raw JSON', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'x' })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    expect(raw).toHaveProperty('stored');
    expect(raw).toHaveProperty('version', '1.0.3');
    expect(raw).toHaveProperty('id', 'x');
  });

  it('defaults timestamp to the same value as stored when not provided', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'x' })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, string>;
    expect(raw.timestamp).toBe(raw.stored);
  });

  it('preserves client-provided timestamp but still sets stored', async () => {
    const clientTimestamp = '2024-06-15T10:30:00.000Z';
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'x', timestamp: clientTimestamp })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, string>;
    expect(raw.timestamp).toBe(clientTimestamp);
    expect(raw.stored).toBeDefined();
    expect(raw.stored).not.toBe(clientTimestamp);
  });

  it('overwrites client-provided stored value', async () => {
    const pool = mockPool();
    const stmt = { ...makeStatement({ id: 'x' }), stored: '1999-01-01T00:00:00.000Z' } as Statement;
    await Q.storeStatements(pool, [stmt]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, string>;
    expect(raw.stored).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('overwrites client-provided version', async () => {
    const pool = mockPool();
    const stmt = { ...makeStatement({ id: 'x' }), version: '0.9' } as Statement;
    await Q.storeStatements(pool, [stmt]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, string>;
    expect(raw.version).toBe('1.0.3');
  });

  it('uses timestamp column value matching raw JSON timestamp', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({ id: 'x' })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    const timestampCol = insert?.values?.[5] as string;
    const rawJson = insert?.values?.[6] as string;
    const raw = JSON.parse(rawJson) as Record<string, string>;
    expect(timestampCol).toBe(raw.timestamp);
  });

  it('stores multiple statements sequentially', async () => {
    const pool = mockPool();
    const ids = await Q.storeStatements(pool, [
      makeStatement({ id: 'a' }),
      makeStatement({ id: 'b' }),
    ]);
    expect(ids).toEqual(['a', 'b']);
    const insertCalls = pool.calls.filter((c) => c.name === 'xapi_stmt_insert');
    expect(insertCalls).toHaveLength(2);
  });

  it('extracts registration from context', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      context: { registration: 'reg-uuid' },
    })]);
    const insert = findCall(pool, 'xapi_stmt_insert');
    expect(insert?.values?.[4]).toBe('reg-uuid');
  });

  it('upserts activity when object is an Activity', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      object: { id: 'http://example.com/act', definition: { name: { en: 'Test' } } },
    })]);
    const activityCall = pool.calls.find((c) => c.name === 'xapi_activity_upsert');
    expect(activityCall).toBeDefined();
    expect(activityCall?.values?.[0]).toBe('http://example.com/act');
    const defJson = JSON.parse(activityCall?.values?.[1] as string) as Record<string, unknown>;
    expect(defJson).toEqual({ name: { en: 'Test' } });
  });

  it('upserts activity with null definition when Activity has no definition', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      object: { id: 'http://example.com/act' },
    })]);
    const activityCall = pool.calls.find((c) => c.name === 'xapi_activity_upsert');
    expect(activityCall).toBeDefined();
    expect(activityCall?.values?.[1]).toBeNull();
  });

  it('does not upsert activity when object is StatementRef', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      object: { objectType: 'StatementRef', id: 'ref-id' },
    })]);
    const activityCall = pool.calls.find((c) => c.name === 'xapi_activity_upsert');
    expect(activityCall).toBeUndefined();
  });

  it('upserts agent for the actor', async () => {
    const pool = mockPool();
    await Q.storeStatements(pool, [makeStatement({
      id: 'x',
      actor: { mbox: 'mailto:alice@example.com', name: 'Alice' },
    })]);
    const agentReadCall = pool.calls.find((c) => c.name === 'xapi_agent_lock');
    expect(agentReadCall).toBeDefined();
    expect(agentReadCall?.values?.[0]).toBe('mbox:mailto:alice@example.com');

    const agentUpsertCall = pool.calls.find((c) => c.name === 'xapi_agent_upsert');
    expect(agentUpsertCall).toBeDefined();
    const personData = JSON.parse(agentUpsertCall?.values?.[1] as string) as Record<string, unknown>;
    expect(personData).toEqual({ name: ['Alice'], mbox: ['mailto:alice@example.com'] });
  });

  it('throws 409 when duplicate id has different content', async () => {
    const queryFn = vi.fn((...args: unknown[]) => {
      const name = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>).name as string | undefined : undefined;
      if (name === 'xapi_stmt_insert') return Promise.resolve({ rows: [], rowCount: 0 });
      if (name === 'xapi_stmt_get_raw') {
        return Promise.resolve({
          rows: [{ raw: { id: 'dup-id', actor: { mbox: 'mailto:other@example.com' }, verb: { id: 'http://example.com/other' }, object: { id: 'http://example.com/other' }, timestamp: '2025-01-01T00:00:00.000Z' } }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const pool = { query: queryFn } as unknown as pg.Pool;

    await expect(
      Q.storeStatements(pool, [makeStatement({ id: 'dup-id' })]),
    ).rejects.toThrow('already exists with different content');
  });

  it('succeeds (idempotent) when duplicate id has identical content', async () => {
    const stmt = makeStatement({ id: 'dup-id' });
    const queryFn = vi.fn((...args: unknown[]) => {
      const name = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>).name as string | undefined : undefined;
      if (name === 'xapi_stmt_insert') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (name === 'xapi_stmt_get_raw') {
        return Promise.resolve({
          rows: [{ raw: { ...stmt, id: 'dup-id', timestamp: stmt.timestamp ?? expect.any(String), stored: '2025-01-01T00:00:00.000Z', version: '1.0.3' } }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const pool = { query: queryFn } as unknown as pg.Pool;

    const ids = await Q.storeStatements(pool, [stmt]);
    expect(ids).toEqual(['dup-id']);
  });

  it('skips side effects for idempotent duplicates', async () => {
    const stmt = makeStatement({ id: 'dup-id' });
    const callNames: string[] = [];
    const queryFn = vi.fn((...args: unknown[]) => {
      const name = typeof args[0] === 'object' ? (args[0] as Record<string, unknown>).name as string | undefined : undefined;
      const text = typeof args[0] === 'string' ? args[0] : (args[0] as Record<string, unknown>).text as string | undefined;
      const label = name ?? text ?? 'unknown';
      callNames.push(label);
      if (name === 'xapi_stmt_insert') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (name === 'xapi_stmt_get_raw') {
        return Promise.resolve({
          rows: [{ raw: { ...stmt, id: 'dup-id', stored: '2025-01-01T00:00:00.000Z', version: '1.0.3' } }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const pool = { query: queryFn } as unknown as pg.Pool;

    await Q.storeStatements(pool, [stmt]);
    expect(callNames).not.toContain('xapi_activity_upsert');
    expect(callNames).not.toContain('xapi_agent_lock');
    expect(callNames).not.toContain('xapi_agent_upsert');
    expect(callNames).not.toContain('xapi_stmt_void_target');
  });
});

describe('statementsMatch', () => {
  it('returns true for identical statements', () => {
    const a = { id: '1', actor: { mbox: 'mailto:a@b.com' }, verb: { id: 'v' }, object: { id: 'o' }, stored: 's1', version: '1.0.3' };
    const b = { id: '1', actor: { mbox: 'mailto:a@b.com' }, verb: { id: 'v' }, object: { id: 'o' }, stored: 's2', version: '1.0.3' };
    expect(Q.statementsMatch(a, b)).toBe(true);
  });

  it('returns false when content differs', () => {
    const a = { id: '1', actor: { mbox: 'mailto:a@b.com' }, verb: { id: 'v1' }, object: { id: 'o' }, stored: 's', version: '1.0.3' };
    const b = { id: '1', actor: { mbox: 'mailto:a@b.com' }, verb: { id: 'v2' }, object: { id: 'o' }, stored: 's', version: '1.0.3' };
    expect(Q.statementsMatch(a, b)).toBe(false);
  });

  it('ignores stored, version, authority, and timestamp differences', () => {
    const a = { id: '1', verb: { id: 'v' }, stored: 'x', version: '1.0.2', authority: { name: 'A' }, timestamp: 't1' };
    const b = { id: '1', verb: { id: 'v' }, stored: 'y', version: '1.0.3', authority: { name: 'B' }, timestamp: 't2' };
    expect(Q.statementsMatch(a, b)).toBe(true);
  });
});

describe('getStatement', () => {
  it('returns null when no rows', async () => {
    const pool = mockPool([]);
    expect(await Q.getStatement(pool, 'missing')).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_stmt_get');
  });

  it('returns raw from first row', async () => {
    const stmt = makeStatement({ id: 'found' });
    const pool = mockPool([{ raw: stmt }]);
    expect(await Q.getStatement(pool, 'found')).toEqual(stmt);
    expect(pool.calls[0]?.name).toBe('xapi_stmt_get');
  });
});

describe('getVoidedStatement', () => {
  it('returns null when no rows', async () => {
    const pool = mockPool([]);
    expect(await Q.getVoidedStatement(pool, 'missing')).toBeNull();
  });

  it('returns raw from first row', async () => {
    const stmt = makeStatement({ id: 'voided-1' });
    const pool = mockPool([{ raw: stmt }]);
    expect(await Q.getVoidedStatement(pool, 'voided-1')).toEqual(stmt);
    expect(pool.calls[0]?.name).toBe('xapi_stmt_get_voided');
  });
});
