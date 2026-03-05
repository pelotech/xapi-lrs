import { SlidingWindowRateLimiter } from './rate-limit.js';

describe('SlidingWindowRateLimiter', () => {
  let limiter: SlidingWindowRateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it('allows requests under the limit', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const now = 60_000; // align to bucket boundary

    for (let i = 0; i < 5; i++) {
      const result = limiter.check('key', now + i);
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects requests over the limit', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const now = 60_000;

    for (let i = 0; i < 3; i++) {
      expect(limiter.check('key', now + i).allowed).toBe(true);
    }

    const result = limiter.check('key', now + 3);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it('tracks keys independently', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const now = 60_000;

    expect(limiter.check('a', now).allowed).toBe(true);
    expect(limiter.check('a', now + 1).allowed).toBe(true);
    expect(limiter.check('a', now + 2).allowed).toBe(false);

    // 'b' should still be allowed
    expect(limiter.check('b', now + 3).allowed).toBe(true);
  });

  it('returns correct remaining count', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const now = 60_000;

    expect(limiter.check('key', now).remaining).toBe(4);
    expect(limiter.check('key', now + 1).remaining).toBe(3);
    expect(limiter.check('key', now + 2).remaining).toBe(2);
  });

  it('slides the window — previous bucket counts decay', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 10 });

    // Fill 8 requests in the first window
    const t0 = 1000;
    for (let i = 0; i < 8; i++) {
      limiter.check('key', t0 + i);
    }

    // 50% into next window → estimated = 8 * 0.5 + curr = 4
    // Should allow more requests
    const halfWay = 2000 + 500;
    const result = limiter.check('key', halfWay);
    expect(result.allowed).toBe(true);
    // estimated ≈ 4 + 1 = 5 after this request, remaining ≈ 4
    expect(result.remaining).toBeGreaterThanOrEqual(4);
  });

  it('resets after two full windows of inactivity', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2 });
    const t0 = 1000;

    expect(limiter.check('key', t0).allowed).toBe(true);
    expect(limiter.check('key', t0 + 1).allowed).toBe(true);
    expect(limiter.check('key', t0 + 2).allowed).toBe(false);

    // After 2 full windows, everything resets
    const t1 = t0 + 3000;
    expect(limiter.check('key', t1).allowed).toBe(true);
  });

  describe('prune', () => {
    it('removes stale entries older than 2 * windowMs', () => {
      limiter = new SlidingWindowRateLimiter({
        windowMs: 1000,
        maxRequests: 100,
        pruneIntervalMs: 999_999, // disable auto-prune
      });

      limiter.check('old', 1000);
      limiter.check('recent', 4000);

      // At time 5000, "old" (bucket start=1000) is older than 5000 - 2*1000 = 3000
      const pruned = limiter.prune(5000);
      expect(pruned).toBe(1);
      expect(limiter.size).toBe(1);
    });

    it('keeps entries within the window', () => {
      limiter = new SlidingWindowRateLimiter({
        windowMs: 1000,
        maxRequests: 100,
        pruneIntervalMs: 999_999,
      });

      limiter.check('a', 3000);
      limiter.check('b', 3500);

      const pruned = limiter.prune(4000);
      expect(pruned).toBe(0);
      expect(limiter.size).toBe(2);
    });
  });

  describe('destroy', () => {
    it('can be called multiple times safely', () => {
      limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 10 });
      limiter.destroy();
      limiter.destroy(); // no throw
    });
  });

  it('retryAfterSec is at least 1', () => {
    limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 1000;
    limiter.check('key', now);
    const result = limiter.check('key', now + 999);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});
