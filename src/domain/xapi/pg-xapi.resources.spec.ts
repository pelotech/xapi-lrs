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

const AGENT = { mbox: 'mailto:test@example.com' } as const;

// ---------------------------------------------------------------------------
// agentToPersonData / mergePersonData
// ---------------------------------------------------------------------------

describe('agentToPersonData', () => {
  it('extracts mbox and name', () => {
    const data = Q.agentToPersonData({ mbox: 'mailto:a@b.com', name: 'A' });
    expect(data).toEqual({ name: ['A'], mbox: ['mailto:a@b.com'] });
  });

  it('extracts account', () => {
    const data = Q.agentToPersonData({ account: { homePage: 'https://lms.example.com', name: 'user1' } });
    expect(data).toEqual({ account: [{ homePage: 'https://lms.example.com', name: 'user1' }] });
  });

  it('extracts openid', () => {
    const data = Q.agentToPersonData({ openid: 'https://openid.example.com/u' });
    expect(data).toEqual({ openid: ['https://openid.example.com/u'] });
  });

  it('omits empty fields', () => {
    const data = Q.agentToPersonData({ mbox: 'mailto:a@b.com' });
    expect(data).toEqual({ mbox: ['mailto:a@b.com'] });
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('account');
  });
});

describe('mergePersonData', () => {
  it('merges disjoint fields', () => {
    const merged = Q.mergePersonData(
      { name: ['Alice'] },
      { mbox: ['mailto:alice@example.com'] },
    );
    expect(merged).toEqual({ name: ['Alice'], mbox: ['mailto:alice@example.com'] });
  });

  it('deduplicates scalar arrays', () => {
    const merged = Q.mergePersonData(
      { name: ['Alice'], mbox: ['mailto:a@b.com'] },
      { name: ['Alice', 'Bob'], mbox: ['mailto:a@b.com'] },
    );
    expect(merged.name).toEqual(['Alice', 'Bob']);
    expect(merged.mbox).toEqual(['mailto:a@b.com']);
  });

  it('deduplicates accounts by homePage|name', () => {
    const acc1 = { homePage: 'https://lms.example.com', name: 'user1' };
    const acc2 = { homePage: 'https://lms.example.com', name: 'user2' };
    const merged = Q.mergePersonData(
      { account: [acc1] },
      { account: [acc1, acc2] },
    );
    expect(merged.account).toHaveLength(2);
    expect(merged.account).toEqual([acc1, acc2]);
  });

  it('handles empty existing data', () => {
    const merged = Q.mergePersonData(
      {},
      { name: ['Bob'], mbox: ['mailto:bob@b.com'] },
    );
    expect(merged).toEqual({ name: ['Bob'], mbox: ['mailto:bob@b.com'] });
  });

  it('handles empty incoming data', () => {
    const merged = Q.mergePersonData(
      { name: ['Alice'] },
      {},
    );
    expect(merged).toEqual({ name: ['Alice'] });
  });
});

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

describe('getActivity', () => {
  it('returns null when not found', async () => {
    const pool = mockPool([]);
    expect(await Q.getActivity(pool, 'http://act/1')).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_activity_get');
  });

  it('returns Activity with definition', async () => {
    const pool = mockPool([{ id: 'http://act/1', definition: { name: { en: 'Test' } } }]);
    const act = await Q.getActivity(pool, 'http://act/1');
    expect(act).toEqual({
      objectType: 'Activity',
      id: 'http://act/1',
      definition: { name: { en: 'Test' } },
    });
  });

  it('returns Activity without definition when null', async () => {
    const pool = mockPool([{ id: 'http://act/1', definition: null }]);
    const act = await Q.getActivity(pool, 'http://act/1');
    expect(act).toEqual({ objectType: 'Activity', id: 'http://act/1' });
    expect(act).not.toHaveProperty('definition');
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

describe('getAgent', () => {
  it('returns null when not found', async () => {
    const pool = mockPool([]);
    expect(await Q.getAgent(pool, AGENT)).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_agent_get');
  });

  it('returns Person with populated fields', async () => {
    const pool = mockPool([{
      person_data: {
        name: ['Test User'],
        mbox: ['mailto:test@example.com'],
        mbox_sha1sum: [],
        openid: [],
        account: [],
      },
    }]);
    const person = await Q.getAgent(pool, AGENT);
    expect(person).toEqual({
      objectType: 'Person',
      name: ['Test User'],
      mbox: ['mailto:test@example.com'],
    });
    expect(person).not.toHaveProperty('mbox_sha1sum');
    expect(person).not.toHaveProperty('openid');
    expect(person).not.toHaveProperty('account');
  });

  it('includes all non-empty fields', async () => {
    const pool = mockPool([{
      person_data: {
        name: ['A'],
        mbox: ['mailto:a@b.com'],
        mbox_sha1sum: ['sha1'],
        openid: ['https://openid'],
        account: [{ homePage: 'https://lms', name: 'user' }],
      },
    }]);
    const person = await Q.getAgent(pool, AGENT);
    expect(person?.name).toEqual(['A']);
    expect(person?.mbox).toEqual(['mailto:a@b.com']);
    expect(person?.mbox_sha1sum).toEqual(['sha1']);
    expect(person?.openid).toEqual(['https://openid']);
    expect(person?.account).toEqual([{ homePage: 'https://lms', name: 'user' }]);
  });
});

// ---------------------------------------------------------------------------
// extractAllActivities
// ---------------------------------------------------------------------------

describe('extractAllActivities', () => {
  const BASE_STMT: Statement = {
    actor: { mbox: 'mailto:a@b.com' },
    verb: { id: 'http://example.com/v' },
    object: { id: 'http://example.com/act', definition: { name: { en: 'Top' } } },
  };

  it('returns the top-level object Activity', () => {
    const result = Q.extractAllActivities(BASE_STMT);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('http://example.com/act');
  });

  it('returns contextActivities from all 4 arrays', () => {
    const stmt: Statement = {
      ...BASE_STMT,
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/parent' }],
          grouping: [{ id: 'http://example.com/grouping' }],
          category: [{ id: 'http://example.com/category' }],
          other: [{ id: 'http://example.com/other' }],
        },
      },
    };
    const result = Q.extractAllActivities(stmt);
    const ids = result.map((a) => a.id);
    expect(ids).toContain('http://example.com/act');
    expect(ids).toContain('http://example.com/parent');
    expect(ids).toContain('http://example.com/grouping');
    expect(ids).toContain('http://example.com/category');
    expect(ids).toContain('http://example.com/other');
    expect(result).toHaveLength(5);
  });

  it('returns SubStatement object and SubStatement contextActivities', () => {
    const stmt: Statement = {
      ...BASE_STMT,
      object: {
        objectType: 'SubStatement',
        actor: { mbox: 'mailto:sub@b.com' },
        verb: { id: 'http://example.com/v' },
        object: { id: 'http://example.com/sub-act', definition: { name: { en: 'Sub' } } },
        context: {
          contextActivities: {
            parent: [{ id: 'http://example.com/sub-parent' }],
          },
        },
      },
    };
    const result = Q.extractAllActivities(stmt);
    const ids = result.map((a) => a.id);
    expect(ids).toContain('http://example.com/sub-act');
    expect(ids).toContain('http://example.com/sub-parent');
  });

  it('deduplicates by id', () => {
    const stmt: Statement = {
      ...BASE_STMT,
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/act' }],
        },
      },
    };
    const result = Q.extractAllActivities(stmt);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when object is not an Activity', () => {
    const stmt: Statement = {
      ...BASE_STMT,
      object: { objectType: 'StatementRef', id: 'some-uuid' },
    };
    const result = Q.extractAllActivities(stmt);
    expect(result).toHaveLength(0);
  });

  it('storeStatements calls upsert for contextActivities', async () => {
    const stmt: Statement = {
      ...BASE_STMT,
      context: {
        contextActivities: {
          parent: [{ id: 'http://example.com/parent', definition: { name: { en: 'Parent' } } }],
        },
      },
    };
    const pool = mockPool([]);
    await Q.storeStatements(pool, [stmt]);
    const upsertCalls = pool.calls.filter((c) => c.name === 'xapi_activity_upsert');
    expect(upsertCalls).toHaveLength(2);
    const upsertedIds = upsertCalls.map((c) => c.values?.[0]);
    expect(upsertedIds).toContain('http://example.com/act');
    expect(upsertedIds).toContain('http://example.com/parent');
  });
});
