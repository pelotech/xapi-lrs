/**
 * Shared dependency interface for LRS controllers and IoC.
 */

import type { JwksCache, JwtConfig } from './auth/jwt.ts';
import type { DbPool } from './db.ts';
import type { Logger } from './logger.ts';
import type { LrsMetrics } from './metrics.ts';

export interface LrsDeps {
  pool: DbPool;
  metrics: LrsMetrics;
  logger: Logger;
  jwksCache: JwksCache;
  jwtConfig: JwtConfig | null;
  xapiVerifySignatures: boolean;
}
