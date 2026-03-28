/**
 * Shared dependency interface for LRS controllers and IoC.
 */

import type { Pool } from "pg";
import type { Logger } from "./logger.ts";
import type { LrsMetrics } from "./metrics.ts";
import type { JwksCache, JwtConfig } from "./auth/jwt.ts";

export interface LrsDeps {
  pool: Pool;
  metrics: LrsMetrics;
  logger: Logger;
  jwksCache: JwksCache;
  jwtConfig: JwtConfig | null;
  xapiVerifySignatures: boolean;
}
