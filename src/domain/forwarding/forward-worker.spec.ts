import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import { ForwardWorker, prepareStatement } from './forward-worker.js';
import type { PgNotifyListener } from '../../core/pg-notify.js';

const logger = pino({ level: 'silent' });

function createMockNotifyListener() {
  const emitter = new EventEmitter();
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    listen: () => Promise.resolve(),
    on: (ch: string, cb: (payload: string) => void) => emitter.on(ch, cb),
    off: (ch: string, cb: (payload: string) => void) => { emitter.off(ch, cb); },
    emit: (ch: string, payload: string) => emitter.emit(ch, payload),
    listenerCount: (ch: string) => emitter.listenerCount(ch),
  } as unknown as PgNotifyListener & {
    emit: (ch: string, payload: string) => boolean;
    listenerCount: (ch: string) => number;
  };
}

function createMockPool(queryFn?: (...args: unknown[]) => Promise<{ rows: unknown[] }>) {
  const defaultQuery = () => Promise.resolve({ rows: [] });
  return {
    query: queryFn ?? defaultQuery,
    connect: () => Promise.resolve({ query: queryFn ?? defaultQuery, release: () => undefined }),
    end: () => Promise.resolve(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    on: () => undefined,
  } as unknown as import('pg').Pool;
}

// -- prepareStatement --

describe('prepareStatement', () => {
  it('strips stored and authority, preserves id/timestamp/version', () => {
    const raw = {
      id: 'abc-123',
      actor: { mbox: 'mailto:test@example.com' },
      verb: { id: 'http://example.com/verb' },
      object: { id: 'http://example.com/activity' },
      timestamp: '2024-01-01T00:00:00Z',
      version: '1.0.3',
      stored: '2024-01-01T00:00:01Z',
      authority: { objectType: 'Agent', mbox: 'mailto:lrs@example.com' },
    };

    const prepared = prepareStatement(raw) as Record<string, unknown>;

    expect(prepared).not.toHaveProperty('stored');
    expect(prepared).not.toHaveProperty('authority');
    expect(prepared.id).toBe('abc-123');
    expect(prepared.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(prepared.version).toBe('1.0.3');
    expect(prepared.actor).toBeDefined();
    expect(prepared.verb).toBeDefined();
    expect(prepared.object).toBeDefined();
  });

  it('returns non-object values as-is', () => {
    expect(prepareStatement(null)).toBeNull();
    expect(prepareStatement('string')).toBe('string');
    expect(prepareStatement(42)).toBe(42);
  });

  it('does not mutate the original object', () => {
    const raw = { id: '1', stored: 'x', authority: 'y', verb: 'z' };
    prepareStatement(raw);
    expect(raw).toHaveProperty('stored');
    expect(raw).toHaveProperty('authority');
  });
});

// -- ForwardWorker --

describe('ForwardWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ignores notifications for tenants without targets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));

    const pool = createMockPool(() => Promise.resolve({ rows: [] }));
    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: 'unknown-tenant', id: 'stmt-1' }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchSpy).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('buffers notifications and deduplicates IDs within batch window', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    let queryCount = 0;

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      // First call: loadTargets
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: 'Basic dGVzdA==',
            enabled: true,
            last_forwarded_stored: null,
          }],
        });
      }
      // Fetch full statements for flush
      if (query.includes('xapi.statements') && query.includes('IN')) {
        queryCount++;
        return Promise.resolve({
          rows: [{
            id: 'stmt-1',
            raw: { id: 'stmt-1', verb: { id: 'http://example.com/verb' }, stored: '2024-01-01T00:00:00Z', authority: {} },
            stored: new Date('2024-01-01T00:00:00Z'),
          }],
        });
      }
      // Catch-up query (returns empty — no backlog)
      if (query.includes('xapi.statements') && query.includes('voided')) {
        return Promise.resolve({ rows: [] });
      }
      // Watermark/error updates
      return Promise.resolve({ rows: [] });
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    // Send duplicate notifications
    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: tenantId, id: 'stmt-1' }));
    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: tenantId, id: 'stmt-1' }));

    await vi.advanceTimersByTimeAsync(600);

    // Should only query once for the deduped ID
    expect(queryCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await worker.stop();
  });

  it('sends correct headers and strips stored/authority', async () => {
    const tenantId = '22222222-2222-2222-2222-222222222222';

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: 'Basic creds',
            enabled: true,
            last_forwarded_stored: null,
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('IN')) {
        return Promise.resolve({
          rows: [{
            id: 'stmt-2',
            raw: {
              id: 'stmt-2',
              verb: { id: 'http://example.com/verb' },
              timestamp: '2024-01-01T00:00:00Z',
              version: '1.0.3',
              stored: '2024-01-01T00:00:01Z',
              authority: { objectType: 'Agent' },
            },
            stored: new Date('2024-01-01T00:00:01Z'),
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('voided')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    let capturedInit: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedInit = init;
      return new Response('[]', { status: 200 });
    });

    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: tenantId, id: 'stmt-2' }));
    await vi.advanceTimersByTimeAsync(600);

    expect(capturedInit).toBeDefined();
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Experience-API-Version']).toBe('1.0.3');
    expect(headers['Authorization']).toBe('Basic creds');

    const body = JSON.parse(capturedInit!.body as string) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).not.toHaveProperty('stored');
    expect(body[0]).not.toHaveProperty('authority');
    expect(body[0]!['id']).toBe('stmt-2');
    expect(body[0]!['timestamp']).toBe('2024-01-01T00:00:00Z');
    expect(body[0]!['version']).toBe('1.0.3');

    await worker.stop();
  });

  it('retries with exponential backoff on HTTP errors', async () => {
    const tenantId = '33333333-3333-3333-3333-333333333333';
    let updateCalls: string[] = [];

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: '',
            enabled: true,
            last_forwarded_stored: null,
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('IN')) {
        return Promise.resolve({
          rows: [{
            id: 'stmt-3',
            raw: { id: 'stmt-3', verb: { id: 'v' } },
            stored: new Date('2024-01-01T00:00:00Z'),
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('voided')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE') && query.includes('last_error')) {
        updateCalls.push(query);
      }
      return Promise.resolve({ rows: [] });
    });

    let fetchAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchAttempts++;
      return new Response('Internal Server Error', { status: 500 });
    });

    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: tenantId, id: 'stmt-3' }));

    // Flush the batch window (500ms) + all retry delays (1s + 2s + 4s + 8s = 15s) + buffer
    await vi.advanceTimersByTimeAsync(600);    // flush
    await vi.advanceTimersByTimeAsync(1000);   // retry 1
    await vi.advanceTimersByTimeAsync(2000);   // retry 2
    await vi.advanceTimersByTimeAsync(4000);   // retry 3
    await vi.advanceTimersByTimeAsync(8000);   // retry 4

    expect(fetchAttempts).toBe(5);
    // Error should be recorded after max retries
    expect(updateCalls.length).toBeGreaterThan(0);

    await worker.stop();
  });

  it('catch-up queries from watermark and filters voided statements', async () => {
    const tenantId = '44444444-4444-4444-4444-444444444444';
    let catchUpQueries: string[] = [];

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: '',
            enabled: true,
            last_forwarded_stored: new Date('2024-01-01T00:00:00Z'),
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('voided')) {
        catchUpQueries.push(query);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));

    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    // Catch-up should have queried with watermark
    expect(catchUpQueries.length).toBeGreaterThan(0);
    expect(catchUpQueries[0]).toContain('stored >');
    expect(catchUpQueries[0]).toContain('voided = FALSE');

    await worker.stop();
  });

  it('stop() unsubscribes and clears timers', async () => {
    const pool = createMockPool(() => Promise.resolve({ rows: [] }));
    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    const listenerCount = listener.listenerCount('xapi_statements_new');
    expect(listenerCount).toBe(1);

    await worker.stop();

    const afterCount = listener.listenerCount('xapi_statements_new');
    expect(afterCount).toBe(0);
  });

  it('reloadTargets() picks up newly enabled targets', async () => {
    const tenantId = '55555555-5555-5555-5555-555555555555';
    let callCount = 0;

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ rows: [] }); // Initially empty
        }
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: '',
            enabled: true,
            last_forwarded_stored: null,
          }],
        });
      }
      if (query.includes('xapi.statements')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    expect(callCount).toBe(1);

    await worker.reloadTargets();
    expect(callCount).toBe(2);

    await worker.stop();
  });

  it('clears error on successful POST', async () => {
    const tenantId = '66666666-6666-6666-6666-666666666666';
    let clearedError = false;

    const pool = createMockPool((sql: unknown) => {
      const query = String(sql);
      if (query.includes('forward_targets') && query.includes('SELECT')) {
        return Promise.resolve({
          rows: [{
            tenant_id: tenantId,
            url: 'http://upstream/xapi/statements',
            auth_header: '',
            enabled: true,
            last_forwarded_stored: null,
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('IN')) {
        return Promise.resolve({
          rows: [{
            id: 'stmt-6',
            raw: { id: 'stmt-6', verb: { id: 'v' } },
            stored: new Date('2024-01-01T00:00:00Z'),
          }],
        });
      }
      if (query.includes('xapi.statements') && query.includes('voided')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('UPDATE') && query.includes('error_count = 0')) {
        clearedError = true;
      }
      return Promise.resolve({ rows: [] });
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));

    const listener = createMockNotifyListener();
    const worker = new ForwardWorker(pool, listener, logger);
    await worker.start();

    listener.emit('xapi_statements_new', JSON.stringify({ tenant_id: tenantId, id: 'stmt-6' }));
    await vi.advanceTimersByTimeAsync(600);

    expect(clearedError).toBe(true);

    await worker.stop();
  });
});
