/**
 * In-process SSE listener for PGlite.
 *
 * PGlite's db.listen() delivers pg_notify payloads from SQL triggers within
 * the same process. This is the PGlite equivalent of PgListener, which uses a
 * dedicated pg.Client for cross-process LISTEN/NOTIFY.
 */

import type { PGlite } from '@electric-sql/pglite';
import type { Listener, NotificationHandler } from './pg-listener.ts';

export class LocalListener implements Listener {
  private handlers = new Map<string, Set<NotificationHandler>>();
  private unsubs = new Map<string, () => Promise<void>>();
  private stopped = false;

  constructor(private db: PGlite) {}

  async start(): Promise<void> {}

  isReady(): boolean {
    // PGlite db.listen is in-process and effectively always available
    // once the backend has been created.
    return !this.stopped;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const unsub of this.unsubs.values()) {
      await unsub().catch(() => {});
    }
    this.unsubs.clear();
    this.handlers.clear();
  }

  on(channel: string, handler: NotificationHandler): void {
    let handlers = this.handlers.get(channel);
    const isNew = !handlers;
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    handlers.add(handler);

    if (isNew) {
      this.db
        .listen(channel, (payload) => {
          const hs = this.handlers.get(channel);
          if (hs) {
            for (const h of hs) {
              try {
                h(payload);
              } catch {}
            }
          }
        })
        .then((unsub) => {
          this.unsubs.set(channel, unsub);
        })
        .catch(() => {});
    }
  }

  off(channel: string, handler: NotificationHandler): void {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(channel);
      const unsub = this.unsubs.get(channel);
      if (unsub) {
        this.unsubs.delete(channel);
        unsub().catch(() => {});
      }
    }
  }
}
