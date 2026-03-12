/**
 * xAPI Rate Limiting Middleware
 *
 * Sliding-window rate limiter keyed on credential ID (basic auth) or
 * JWT subject (bearer auth). Falls back to client IP for unauthenticated
 * requests (which will typically be rejected by auth middleware anyway).
 *
 * Configuration via env:
 *   XAPI_RATE_LIMIT_WINDOW — window size in seconds (default 60)
 *   XAPI_RATE_LIMIT_MAX    — max requests per window (default 300)
 */

import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../hono-env.ts";
import { resolveClientIp } from "../helpers/client-ip.ts";

export interface RateLimitConfig {
  /** Window size in seconds */
  windowSeconds: number;
  /** Max requests per window */
  maxRequests: number;
  /** Trusted proxy hops for IP extraction */
  trustedProxyHops: number;
}

/**
 * In-memory sliding window rate limiter.
 * Timestamps older than the window are pruned on each check.
 */
class SlidingWindowLimiter {
  private buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;

  /** Interval handle for periodic pruning of stale keys */
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(windowSeconds: number, max: number) {
    this.windowMs = windowSeconds * 1000;
    this.max = max;

    // Prune stale keys every 5 minutes to prevent unbounded memory growth
    this.pruneTimer = setInterval(() => this.pruneStaleKeys(), 5 * 60 * 1000);
    // Don't prevent process exit
    if (this.pruneTimer && typeof this.pruneTimer === "object" && "unref" in this.pruneTimer) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Check if the key is rate-limited. If not, record the request.
   * Returns { limited: false } or { limited: true, retryAfterSeconds }.
   */
  check(key: string): { limited: false } | { limited: true; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.buckets.get(key);

    if (timestamps) {
      // Prune expired entries
      timestamps = timestamps.filter((t) => t > cutoff);
    } else {
      timestamps = [];
    }

    if (timestamps.length >= this.max) {
      // Calculate when the earliest entry expires
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
      this.buckets.set(key, timestamps);
      return { limited: true, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return { limited: false };
  }

  private pruneStaleKeys(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.buckets) {
      const recent = timestamps.filter((t) => t > cutoff);
      if (recent.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, recent);
      }
    }
  }
}

/** Paths exempt from rate limiting. */
const EXEMPT_PATHS = new Set(["/xapi/about"]);

/**
 * Hono middleware that enforces per-identity rate limits on xAPI endpoints.
 */
export function rateLimitMiddleware(config: RateLimitConfig): MiddlewareHandler<HonoEnv> {
  const limiter = new SlidingWindowLimiter(config.windowSeconds, config.maxRequests);

  return async (c, next) => {
    if (EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    // Key: credential ID > JWT sub > client IP
    const auth = c.get("auth") as HonoEnv["Variables"]["auth"] | undefined;
    let key: string;
    if (auth?.type === "basic") {
      key = `cred:${auth.payload.credentialId}`;
    } else if (auth?.type === "jwt") {
      key = `jwt:${auth.payload.sub}`;
    } else {
      key = `ip:${resolveClientIp(c.req.header("x-forwarded-for"), config.trustedProxyHops)}`;
    }

    const result = limiter.check(key);
    if (result.limited) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    return next();
  };
}
