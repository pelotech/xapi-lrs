/**
 * PostgreSQL LISTEN/NOTIFY wrapper.
 * Maintains a dedicated connection for receiving pg_notify events.
 */

import { Client } from 'pg';
import type { Notification } from 'pg';
import type { Logger } from '../logger.ts';
import type { LrsConfig } from '../config.ts';

export type NotificationHandler = (payload: string) => void;

export interface Listener {
  on(channel: string, handler: NotificationHandler): void;
  off(channel: string, handler: NotificationHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Allowlisted channel names to prevent SQL injection in LISTEN commands. */
const ALLOWED_CHANNELS = new Set(['xapi_statement_stored']);

function validateChannel(channel: string): void {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`Invalid LISTEN channel: ${channel}`);
  }
}

export class PgListener {
  private client: Client | null = null;
  private handlers = new Map<string, Set<NotificationHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private config: LrsConfig,
    private logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // Ignore errors during shutdown
      }
      this.client = null;
    }
  }

  on(channel: string, handler: NotificationHandler): void {
    validateChannel(channel);
    let handlers = this.handlers.get(channel);
    const isNew = !handlers;
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    handlers.add(handler);

    // If this is a new channel and the client is already connected, send LISTEN
    if (isNew && this.client) {
      this.client.query(`LISTEN ${channel}`).catch((err) => {
        this.logger.error(err, `Failed to LISTEN on channel ${channel}`);
      });
    }
  }

  off(channel: string, handler: NotificationHandler): void {
    const handlers = this.handlers.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(channel);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    try {
      const client = new Client({
        connectionString: this.config.databaseUrl,
        host: this.config.pgHost,
        port: this.config.pgPort,
        database: this.config.pgDatabase,
        user: this.config.pgUser,
        password: this.config.pgPassword,
      });

      client.on('notification', (msg: Notification) => {
        if (msg.payload) {
          const handlers = this.handlers.get(msg.channel);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(msg.payload);
              } catch (err) {
                this.logger.error(err, 'Error in notification handler');
              }
            }
          }
        }
      });

      client.on('error', (err) => {
        this.logger.error(err, 'PgListener connection error');
        this.scheduleReconnect();
      });

      client.on('end', () => {
        if (!this.stopped) {
          this.logger.warn('PgListener connection closed unexpectedly');
          this.scheduleReconnect();
        }
      });

      await client.connect();
      this.client = client;

      // LISTEN on all registered channels
      for (const channel of this.handlers.keys()) {
        await client.query(`LISTEN ${channel}`);
      }

      this.logger.info({ channels: [...this.handlers.keys()] }, 'PgListener connected and listening');
    } catch (err) {
      this.logger.error(err, 'PgListener failed to connect');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.client = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 3000);
  }
}
