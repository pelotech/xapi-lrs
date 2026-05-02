/**
 * Admin UI types.
 */

import type { DbPool } from '../db.ts';
import type { Logger } from '../logger.ts';
import type { LrsMetrics } from '../metrics.ts';
import type { Listener } from '../sse/pg-listener.ts';

export interface AdminSession {
  accountId: string;
  username: string;
  exp: number;
}

export type AdminEnv = {
  Variables: {
    adminSession: AdminSession;
    csrfToken: string;
    /** Per-request child logger (set by parent app middleware) */
    logger: Logger;
  };
};

export interface AdminDeps {
  pool: DbPool;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: Listener;
  sessionSecret: string;
  startedAt: Date;
  trustedProxyHops: number;
}
