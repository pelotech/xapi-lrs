/**
 * Shared PostgreSQL LISTEN/NOTIFY listener.
 *
 * Uses a dedicated pg.Client (not from the pool) so the persistent LISTEN
 * connection doesn't consume a pool slot. Wraps Node EventEmitter to dispatch
 * typed notifications per channel. Auto-reconnects with exponential backoff
 * on connection loss.
 */

import pg from 'pg';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/** Double-quote a SQL identifier (channel name). */
function quoteIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export class PgNotifyListener {
  private client: pg.Client | null = null;
  private readonly emitter = new EventEmitter();
  private readonly channels = new Set<string>();
  private stopping = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

  constructor(
    private readonly connectionString: string,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // ignore errors on shutdown
      }
      this.client = null;
    }
    this.emitter.removeAllListeners();
  }

  /** Subscribe to notifications on a channel. */
  on(channel: string, cb: (payload: string) => void): void {
    this.emitter.on(channel, cb);
  }

  /** Unsubscribe from notifications on a channel. */
  off(channel: string, cb: (payload: string) => void): void {
    this.emitter.off(channel, cb);
  }

  /** Register a channel to LISTEN on. Call before or after start(). */
  async listen(channel: string): Promise<void> {
    this.channels.add(channel);
    if (this.client) {
      await this.client.query(`LISTEN ${quoteIdentifier(channel)}`);
    }
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });

    client.on('notification', (msg) => {
      if (msg.payload) {
        this.emitter.emit(msg.channel, msg.payload);
      }
    });

    client.on('error', (err) => {
      this.logger.warn({ err }, 'PgNotifyListener connection error');
      this.scheduleReconnect();
    });

    client.on('end', () => {
      if (!this.stopping) {
        this.logger.warn('PgNotifyListener connection ended unexpectedly');
        this.scheduleReconnect();
      }
    });

    try {
      await client.connect();
      this.client = client;
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

      // Re-subscribe to all channels
      for (const channel of this.channels) {
        await client.query(`LISTEN ${quoteIdentifier(channel)}`);
      }

      this.logger.info({ channels: [...this.channels] }, 'PgNotifyListener connected');
    } catch (err) {
      this.logger.warn({ err }, 'PgNotifyListener failed to connect');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;

    this.client = null;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);

    this.logger.info({ delayMs: delay }, 'PgNotifyListener scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // connect() handles its own errors and schedules retry
      });
    }, delay);
  }
}
