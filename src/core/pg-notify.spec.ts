import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

// Mock pg.Client so we don't need a real PG connection.
// The factory must not reference top-level imports since vi.mock is hoisted.
vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events');
  class MockClient extends EventEmitter {
    _listened: string[] = [];
    async connect() { /* noop */ }
    async end() { this.emit('end'); }
    async query(sql: string) {
      if (sql.startsWith('LISTEN')) {
        this._listened.push(sql);
      }
    }
  }
  return {
    default: { Client: MockClient },
    Client: MockClient,
  };
});

const logger = pino({ level: 'silent' });

describe('PgNotifyListener', () => {
  it('emits events when notifications arrive', async () => {
    const { PgNotifyListener } = await import('./pg-notify.js');
    const { EventEmitter } = await import('node:events');
    const listener = new PgNotifyListener('postgresql://localhost/test', logger);
    await listener.start();
    await listener.listen('test_channel');

    const received: string[] = [];
    listener.on('test_channel', (payload) => received.push(payload));

    // Simulate a PG notification by accessing the internal client
    const client = (listener as unknown as { client: InstanceType<typeof EventEmitter> }).client;
    client.emit('notification', {
      channel: 'test_channel',
      payload: '{"id":"123"}',
    });

    expect(received).toEqual(['{"id":"123"}']);

    await listener.stop();
  });

  it('off() unsubscribes correctly', async () => {
    const { PgNotifyListener } = await import('./pg-notify.js');
    const { EventEmitter } = await import('node:events');
    const listener = new PgNotifyListener('postgresql://localhost/test', logger);
    await listener.start();
    await listener.listen('test_channel');

    const received: string[] = [];
    const handler = (payload: string) => received.push(payload);
    listener.on('test_channel', handler);
    listener.off('test_channel', handler);

    const client = (listener as unknown as { client: InstanceType<typeof EventEmitter> }).client;
    client.emit('notification', {
      channel: 'test_channel',
      payload: '{"id":"456"}',
    });

    expect(received).toEqual([]);

    await listener.stop();
  });

  it('stop() cleans up the client', async () => {
    const { PgNotifyListener } = await import('./pg-notify.js');
    const listener = new PgNotifyListener('postgresql://localhost/test', logger);
    await listener.start();

    const clientBefore = (listener as unknown as { client: unknown | null }).client;
    expect(clientBefore).not.toBeNull();

    await listener.stop();

    const clientAfter = (listener as unknown as { client: unknown | null }).client;
    expect(clientAfter).toBeNull();
  });

  it('sends LISTEN for pre-registered channels on connect', async () => {
    const { PgNotifyListener } = await import('./pg-notify.js');
    const listener = new PgNotifyListener('postgresql://localhost/test', logger);
    // Register channel before starting
    await listener.listen('pre_registered');
    await listener.start();

    const client = (listener as unknown as { client: { _listened: string[] } }).client;
    expect(client._listened).toContainEqual(expect.stringContaining('pre_registered'));

    await listener.stop();
  });
});
