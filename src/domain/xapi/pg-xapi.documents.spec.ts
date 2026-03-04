import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import * as Q from './pg-xapi.queries.js';

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

function upsertValues(pool: pg.Pool, callIndex: number): unknown[] {
  const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls[callIndex];
  if (!call) throw new Error(`No query call at index ${String(callIndex)}`);
  return (call[0] as { values: unknown[] }).values;
}

const AGENT = { mbox: 'mailto:test@example.com' } as const;

// ---------------------------------------------------------------------------
// State documents
// ---------------------------------------------------------------------------

describe('getStateDocument', () => {
  it('returns null when no rows', async () => {
    const pool = mockPool([]);
    expect(await Q.getStateDocument(pool, 'act', AGENT, 'sid')).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_state_get');
  });

  it('maps row to StoredDocument', async () => {
    const now = new Date();
    const pool = mockPool([{
      content: Buffer.from('hello'),
      content_type: 'text/plain',
      etag: '"abc"',
      updated_at: now,
    }]);
    const doc = await Q.getStateDocument(pool, 'act', AGENT, 'sid');
    expect(doc).toEqual({
      content: Buffer.from('hello'),
      contentType: 'text/plain',
      etag: '"abc"',
      updatedAt: now,
    });
  });

  it('passes registration as empty string when omitted', async () => {
    const pool = mockPool([]);
    await Q.getStateDocument(pool, 'act', AGENT, 'sid');
    expect(pool.calls[0]?.values?.[3]).toBe('');
  });

  it('passes registration when provided', async () => {
    const pool = mockPool([]);
    await Q.getStateDocument(pool, 'act', AGENT, 'sid', 'reg-uuid');
    expect(pool.calls[0]?.values?.[3]).toBe('reg-uuid');
  });
});

describe('getStateIds', () => {
  it('uses STATE_LIST query without since', async () => {
    const pool = mockPool([{ document_id: 's1' }, { document_id: 's2' }]);
    const ids = await Q.getStateIds(pool, 'act', AGENT);
    expect(ids).toEqual(['s1', 's2']);
    expect(pool.calls[0]?.name).toBe('xapi_state_list');
  });

  it('uses STATE_LIST_SINCE query with since', async () => {
    const since = new Date('2024-01-01');
    const pool = mockPool([]);
    await Q.getStateIds(pool, 'act', AGENT, undefined, since);
    expect(pool.calls[0]?.name).toBe('xapi_state_list_since');
    expect(pool.calls[0]?.values?.[3]).toBe(since);
  });
});

describe('setStateDocument', () => {
  it('calls STATE_UPSERT and returns etag', async () => {
    const pool = mockPool();
    const content = Buffer.from('data');
    const etag = await Q.setStateDocument(pool, 'act', AGENT, 'sid', content, 'text/plain');
    expect(pool.calls[0]?.name).toBe('xapi_state_upsert');
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);
  });
});

describe('mergeStateDocument', () => {
  it('shallow-merges JSON when both are application/json', async () => {
    const existing = {
      content: Buffer.from(JSON.stringify({ a: 1, b: 2 })),
      content_type: 'application/json',
      etag: '"old"',
      updated_at: new Date(),
    };
    let callCount = 0;
    const pool = {
      query: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [existing], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as pg.Pool;

    const incoming = Buffer.from(JSON.stringify({ b: 99, c: 3 }));
    await Q.mergeStateDocument(pool, 'act', AGENT, 'sid', incoming, 'application/json');

    const vals = upsertValues(pool, 1);
    const merged = JSON.parse((vals[4] as Buffer).toString('utf8')) as Record<string, unknown>;
    expect(merged).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('returns 400 when incoming content-type is not JSON', async () => {
    const pool = mockPool([]);
    await expect(
      Q.mergeStateDocument(pool, 'act', AGENT, 'sid', Buffer.from('binary'), 'application/octet-stream'),
    ).rejects.toThrow('Content-Type application/json');
  });

  it('returns 400 when existing document is not JSON', async () => {
    const existing = {
      content: Buffer.from('binary'),
      content_type: 'application/octet-stream',
      etag: '"old"',
      updated_at: new Date(),
    };
    let callCount = 0;
    const pool = {
      query: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [existing], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as pg.Pool;

    await expect(
      Q.mergeStateDocument(pool, 'act', AGENT, 'sid', Buffer.from('{}'), 'application/json'),
    ).rejects.toThrow('existing document');
  });

  it('stores as-is when no existing document', async () => {
    let callCount = 0;
    const pool = {
      query: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as pg.Pool;

    await Q.mergeStateDocument(pool, 'act', AGENT, 'sid', Buffer.from('{}'), 'application/json');

    const vals = upsertValues(pool, 1);
    expect(vals[5]).toBe('application/json');
  });
});

describe('deleteStateDocument', () => {
  it('calls STATE_DELETE with correct params', async () => {
    const pool = mockPool();
    await Q.deleteStateDocument(pool, 'act', AGENT, 'sid', 'reg');
    expect(pool.calls[0]?.name).toBe('xapi_state_delete');
    expect(pool.calls[0]?.values).toEqual(['act', 'mbox:mailto:test@example.com', 'sid', 'reg']);
  });
});

describe('deleteStateDocuments', () => {
  it('calls STATE_DELETE_ALL', async () => {
    const pool = mockPool();
    await Q.deleteStateDocuments(pool, 'act', AGENT);
    expect(pool.calls[0]?.name).toBe('xapi_state_delete_all');
  });
});

// ---------------------------------------------------------------------------
// Activity Profile documents
// ---------------------------------------------------------------------------

describe('getActivityProfileDocument', () => {
  it('returns null when not found', async () => {
    const pool = mockPool([]);
    expect(await Q.getActivityProfileDocument(pool, 'act', 'p1')).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_ap_get');
  });
});

describe('getActivityProfileIds', () => {
  it('uses AP_LIST without since', async () => {
    const pool = mockPool([{ document_id: 'p1' }]);
    const ids = await Q.getActivityProfileIds(pool, 'act');
    expect(ids).toEqual(['p1']);
    expect(pool.calls[0]?.name).toBe('xapi_ap_list');
  });

  it('uses AP_LIST_SINCE with since', async () => {
    const pool = mockPool([]);
    await Q.getActivityProfileIds(pool, 'act', new Date());
    expect(pool.calls[0]?.name).toBe('xapi_ap_list_since');
  });
});

describe('setActivityProfileDocument', () => {
  it('returns etag', async () => {
    const pool = mockPool();
    const etag = await Q.setActivityProfileDocument(pool, 'act', 'p1', Buffer.from('x'), 'text/plain');
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);
    expect(pool.calls[0]?.name).toBe('xapi_ap_upsert');
  });
});

describe('mergeActivityProfileDocument', () => {
  it('shallow-merges JSON', async () => {
    const existing = {
      content: Buffer.from(JSON.stringify({ a: 1 })),
      content_type: 'application/json',
      etag: '"e"',
      updated_at: new Date(),
    };
    let callCount = 0;
    const pool = {
      query: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [existing], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as pg.Pool;

    await Q.mergeActivityProfileDocument(pool, 'act', 'p1', Buffer.from(JSON.stringify({ b: 2 })), 'application/json');
    const vals = upsertValues(pool, 1);
    const merged = JSON.parse((vals[2] as Buffer).toString('utf8')) as Record<string, unknown>;
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});

describe('deleteActivityProfileDocument', () => {
  it('calls AP_DELETE', async () => {
    const pool = mockPool();
    await Q.deleteActivityProfileDocument(pool, 'act', 'p1');
    expect(pool.calls[0]?.name).toBe('xapi_ap_delete');
    expect(pool.calls[0]?.values).toEqual(['act', 'p1']);
  });
});

// ---------------------------------------------------------------------------
// Agent Profile documents
// ---------------------------------------------------------------------------

describe('getAgentProfileDocument', () => {
  it('returns null when not found', async () => {
    const pool = mockPool([]);
    expect(await Q.getAgentProfileDocument(pool, AGENT, 'p1')).toBeNull();
    expect(pool.calls[0]?.name).toBe('xapi_agp_get');
  });
});

describe('getAgentProfileIds', () => {
  it('uses AGP_LIST without since', async () => {
    const pool = mockPool([{ document_id: 'p1' }]);
    const ids = await Q.getAgentProfileIds(pool, AGENT);
    expect(ids).toEqual(['p1']);
    expect(pool.calls[0]?.name).toBe('xapi_agp_list');
  });

  it('uses AGP_LIST_SINCE with since', async () => {
    const pool = mockPool([]);
    await Q.getAgentProfileIds(pool, AGENT, new Date());
    expect(pool.calls[0]?.name).toBe('xapi_agp_list_since');
  });
});

describe('setAgentProfileDocument', () => {
  it('returns etag', async () => {
    const pool = mockPool();
    const etag = await Q.setAgentProfileDocument(pool, AGENT, 'p1', Buffer.from('x'), 'text/plain');
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);
    expect(pool.calls[0]?.name).toBe('xapi_agp_upsert');
  });
});

describe('mergeAgentProfileDocument', () => {
  it('shallow-merges JSON', async () => {
    const existing = {
      content: Buffer.from(JSON.stringify({ x: 1 })),
      content_type: 'application/json',
      etag: '"e"',
      updated_at: new Date(),
    };
    let callCount = 0;
    const pool = {
      query: vi.fn(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ rows: [existing], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as pg.Pool;

    await Q.mergeAgentProfileDocument(pool, AGENT, 'p1', Buffer.from(JSON.stringify({ y: 2 })), 'application/json');
    const vals = upsertValues(pool, 1);
    const merged = JSON.parse((vals[2] as Buffer).toString('utf8')) as Record<string, unknown>;
    expect(merged).toEqual({ x: 1, y: 2 });
  });
});

describe('deleteAgentProfileDocument', () => {
  it('calls AGP_DELETE', async () => {
    const pool = mockPool();
    await Q.deleteAgentProfileDocument(pool, AGENT, 'p1');
    expect(pool.calls[0]?.name).toBe('xapi_agp_delete');
    expect(pool.calls[0]?.values).toEqual(['mbox:mailto:test@example.com', 'p1']);
  });
});
