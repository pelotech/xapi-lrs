/**
 * Admin UI types.
 */

import type { Pool } from "pg";
import type { LrsMetrics } from "../metrics.ts";
import type { Logger } from "../logger.ts";
import type { PgListener } from "../sse/pg-listener.ts";

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
  pool: Pool;
  metrics: LrsMetrics;
  logger: Logger;
  pgListener: PgListener;
  sessionSecret: string;
  startedAt: Date;
  trustedProxyHops: number;
}
