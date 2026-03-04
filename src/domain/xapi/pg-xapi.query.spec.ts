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

describe('queryStatements', () => {
  it('returns empty result for no rows', async () => {
    const pool = mockPool([]);
    const result = await Q.queryStatements(pool, {});
    expect(result.statements).toEqual([]);
    expect(result.more).toBeUndefined();
  });

  it('defaults to DESC order and limit 100', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, {});
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('ORDER BY stored DESC');
    expect(pool.calls[0]?.values).toEqual([101]);
  });

  it('uses ASC order when ascending is true', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { ascending: true });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('ORDER BY stored ASC');
  });

  it('adds verb filter', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { verb: 'http://example.com/v' });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('verb_id = $1');
    expect(pool.calls[0]?.values?.[0]).toBe('http://example.com/v');
  });

  it('adds activity filter', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { activity: 'http://example.com/a' });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('activity_id = $1');
  });

  it('adds agent filter with IFI conversion', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { agent: { mbox: 'mailto:a@b.com' } });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('actor_ifi = $1');
    expect(pool.calls[0]?.values?.[0]).toBe('mbox:mailto:a@b.com');
  });

  it('adds since and until filters', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { since: '2024-01-01T00:00:00Z', until: '2024-12-31T00:00:00Z' });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('stored > $1');
    expect(sql).toContain('stored <= $2');
  });

  it('combines multiple filters with correct param indices', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, {
      verb: 'v',
      activity: 'a',
      registration: 'r',
      limit: 5,
    });
    const values = pool.calls[0]?.values ?? [];
    expect(values).toEqual(['v', 'a', 'r', 6]);
  });

  it('sets more when rows exceed limit', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      raw: makeStatement({ id: String(i) }),
      stored: `2024-01-0${String(i + 1)}T00:00:00Z`,
      id: String(i),
    }));
    const pool = mockPool(rows);
    const result = await Q.queryStatements(pool, { limit: 3 });
    expect(result.statements).toHaveLength(3);
    expect(result.more).toBeDefined();
  });

  it('does not set more when rows equal limit', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      raw: makeStatement({ id: String(i) }),
      stored: `2024-01-0${String(i + 1)}T00:00:00Z`,
      id: String(i),
    }));
    const pool = mockPool(rows);
    const result = await Q.queryStatements(pool, { limit: 3 });
    expect(result.statements).toHaveLength(3);
    expect(result.more).toBeUndefined();
  });

  it('more URL contains a base64url cursor with stored and id of last row', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      raw: makeStatement({ id: String(i) }),
      stored: `2024-01-0${String(i + 1)}T00:00:00Z`,
      id: String(i),
    }));
    const pool = mockPool(rows);
    const result = await Q.queryStatements(pool, { limit: 3 });
    expect(result.more).toContain('/xapi/statements?cursor=');

    const cursorParam = result.more?.split('cursor=')[1];
    expect(cursorParam).toBeDefined();
    const decoded = Q.decodeCursor(cursorParam as string);
    expect(decoded.stored).toBe('2024-01-03T00:00:00Z');
    expect(decoded.id).toBe('2');
  });

  it('applies cursor for keyset pagination (DESC)', async () => {
    const pool = mockPool([]);
    const cursor = Q.encodeCursor('2024-06-15T00:00:00Z', 'last-id');
    await Q.queryStatements(pool, { cursor });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('(stored, id) < ($');
    const values = pool.calls[0]?.values ?? [];
    expect(values).toContain('2024-06-15T00:00:00Z');
    expect(values).toContain('last-id');
  });

  it('applies cursor for keyset pagination (ASC)', async () => {
    const pool = mockPool([]);
    const cursor = Q.encodeCursor('2024-06-15T00:00:00Z', 'last-id');
    await Q.queryStatements(pool, { cursor, ascending: true });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('(stored, id) > ($');
  });

  it('orders by stored and id for stable pagination', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, {});
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('ORDER BY stored DESC, id DESC');
  });

  it('uses OR with JSONB containment when related_activities=true', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { activity: 'http://example.com/a', related_activities: true });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('activity_id =');
    expect(sql).toContain('@>');
    expect(sql).toContain("contextActivities");
    expect(sql).toContain("'parent'");
    expect(sql).toContain("'grouping'");
    expect(sql).toContain("'category'");
    expect(sql).toContain("'other'");
    expect(sql).toContain('SubStatement');
  });

  it('passes activity ID and JSON array containment as params for related_activities', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { activity: 'http://example.com/a', related_activities: true });
    const values = pool.calls[0]?.values ?? [];
    expect(values).toContain('http://example.com/a');
    expect(values).toContain('[{"id":"http://example.com/a"}]');
  });

  it('uses simple activity_id= when related_activities is false', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { activity: 'http://example.com/a', related_activities: false });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('activity_id = $1');
    expect(sql).not.toContain('@>');
  });

  it('uses OR with JSONB containment when related_agents=true', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { agent: { mbox: 'mailto:a@b.com' }, related_agents: true });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('actor_ifi =');
    expect(sql).toContain('@>');
    expect(sql).toContain("'authority'");
    expect(sql).toContain("'instructor'");
    expect(sql).toContain("'team'");
  });

  it('passes IFI and JSONB containment for mbox agent with related_agents', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { agent: { mbox: 'mailto:a@b.com' }, related_agents: true });
    const values = pool.calls[0]?.values ?? [];
    expect(values).toContain('mbox:mailto:a@b.com');
    expect(values).toContain('{"mbox":"mailto:a@b.com"}');
  });

  it('passes correct JSONB containment for account agent with related_agents', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, {
      agent: { account: { homePage: 'https://lms.example.com', name: 'jdoe' } },
      related_agents: true,
    });
    const values = pool.calls[0]?.values ?? [];
    expect(values).toContain('account:https://lms.example.com|jdoe');
    expect(values).toContain('{"account":{"homePage":"https://lms.example.com","name":"jdoe"}}');
  });

  it('uses simple actor_ifi= when related_agents is false', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, { agent: { mbox: 'mailto:a@b.com' }, related_agents: false });
    const sql = pool.calls[0]?.text ?? '';
    expect(sql).toContain('actor_ifi = $1');
    expect(sql).not.toContain('@>');
  });

  it('indexes params correctly when combining both related flags with other filters', async () => {
    const pool = mockPool([]);
    await Q.queryStatements(pool, {
      verb: 'http://example.com/v',
      activity: 'http://example.com/a',
      related_activities: true,
      agent: { mbox: 'mailto:a@b.com' },
      related_agents: true,
      limit: 5,
    });
    const values = pool.calls[0]?.values ?? [];
    expect(values).toEqual([
      'http://example.com/v',
      'http://example.com/a',
      '[{"id":"http://example.com/a"}]',
      'mbox:mailto:a@b.com',
      '{"mbox":"mailto:a@b.com"}',
      6,
    ]);
  });
});
