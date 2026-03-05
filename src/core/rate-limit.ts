import type { AppConfig } from './config.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

interface Bucket {
  start: number;
  count: number;
}

interface Entry {
  prev: Bucket;
  curr: Bucket;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  pruneIntervalMs?: number;
}

/**
 * Sliding window counter rate limiter.
 *
 * Uses two fixed-time buckets per key with linear interpolation
 * to approximate a sliding window. O(1) per check, O(n) memory
 * for n distinct keys. A periodic prune sweep removes stale entries.
 */
export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.maxRequests = opts.maxRequests;

    const pruneMs = opts.pruneIntervalMs ?? 60_000;
    this.pruneTimer = setInterval(() => this.prune(), pruneMs);
    this.pruneTimer.unref();
  }

  check(key: string, now = Date.now()): RateLimitResult {
    const entry = this.getOrCreate(key, now);
    this.rotateIfNeeded(entry, now);

    const weight = (now - entry.curr.start) / this.windowMs;
    const estimated =
      entry.prev.count * (1 - weight) + entry.curr.count;

    if (estimated >= this.maxRequests) {
      const retryAfterSec = Math.ceil(
        (entry.curr.start + this.windowMs - now) / 1000,
      );
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(retryAfterSec, 1),
      };
    }

    entry.curr.count++;
    const remaining = Math.max(
      0,
      Math.floor(this.maxRequests - estimated - 1),
    );
    return { allowed: true, remaining, retryAfterSec: 0 };
  }

  /** Remove entries older than 2 * windowMs. Returns number pruned. */
  prune(now = Date.now()): number {
    const cutoff = now - 2 * this.windowMs;
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (entry.curr.start < cutoff) {
        this.entries.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /** Stop the prune timer. Call on shutdown. */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private getOrCreate(key: string, now: number): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      const bucketStart = this.bucketStart(now);
      entry = {
        prev: { start: bucketStart - this.windowMs, count: 0 },
        curr: { start: bucketStart, count: 0 },
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private rotateIfNeeded(entry: Entry, now: number): void {
    const currBucket = this.bucketStart(now);
    if (currBucket !== entry.curr.start) {
      if (currBucket - entry.curr.start >= 2 * this.windowMs) {
        // Both buckets expired
        entry.prev = { start: currBucket - this.windowMs, count: 0 };
        entry.curr = { start: currBucket, count: 0 };
      } else {
        entry.prev = entry.curr;
        entry.curr = { start: currBucket, count: 0 };
      }
    }
  }

  private bucketStart(now: number): number {
    return now - (now % this.windowMs);
  }
}

export interface AppRateLimiters {
  readonly ip: SlidingWindowRateLimiter;
  readonly tenant: SlidingWindowRateLimiter;
  readonly admin: SlidingWindowRateLimiter;
  readonly adminLogin: SlidingWindowRateLimiter;
}

export function createRateLimiters(config: AppConfig): AppRateLimiters {
  return {
    ip: new SlidingWindowRateLimiter({
      windowMs: config.RATE_LIMIT_IP_WINDOW_MS,
      maxRequests: config.RATE_LIMIT_IP_MAX_REQUESTS,
    }),
    tenant: new SlidingWindowRateLimiter({
      windowMs: config.RATE_LIMIT_TENANT_WINDOW_MS,
      maxRequests: config.RATE_LIMIT_TENANT_MAX_REQUESTS,
    }),
    admin: new SlidingWindowRateLimiter({
      windowMs: config.RATE_LIMIT_ADMIN_WINDOW_MS,
      maxRequests: config.RATE_LIMIT_ADMIN_MAX_REQUESTS,
    }),
    adminLogin: new SlidingWindowRateLimiter({
      windowMs: config.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS,
      maxRequests: config.RATE_LIMIT_ADMIN_LOGIN_MAX_REQUESTS,
    }),
  };
}

export function destroyRateLimiters(limiters: AppRateLimiters): void {
  limiters.ip.destroy();
  limiters.tenant.destroy();
  limiters.admin.destroy();
  limiters.adminLogin.destroy();
}
