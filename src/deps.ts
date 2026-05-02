/**
 * Shared dependency interface for LRS controllers and IoC.
 */

import type { DbPool } from './db.ts';
import type { Logger } from './logger.ts';
import type { LrsMetrics } from './metrics.ts';
import type { JwksCache, JwtConfig } from './auth/jwt.ts';

export interface LrsDeps {
  pool: DbPool;
  metrics: LrsMetrics;
  logger: Logger;
  jwksCache: JwksCache;
  jwtConfig: JwtConfig | null;
  xapiVerifySignatures: boolean;
}
