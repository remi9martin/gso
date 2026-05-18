import { describe, expect, it } from 'vitest';

import { SlidingWindowRateLimiter } from '@/lib/intake/rate-limit';

class FakeClock {
  constructor(public t = 0) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

describe('SlidingWindowRateLimiter', () => {
  it('allows up to maxRequests in the window', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 10 }, clock);

    for (let i = 0; i < 10; i++) {
      const decision = limiter.consume('k');
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(9 - i);
    }
  });

  it('denies the 11th request and reports retry-after', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 10 }, clock);
    for (let i = 0; i < 10; i++) limiter.consume('k');
    clock.advance(15_000);
    const denied = limiter.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(45_000);
  });

  it('admits new requests after the window slides past', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 3 }, clock);
    limiter.consume('k');
    clock.advance(10_000);
    limiter.consume('k');
    clock.advance(10_000);
    limiter.consume('k');
    expect(limiter.consume('k').allowed).toBe(false);

    // Slide past the first request.
    clock.advance(45_000);
    const allowed = limiter.consume('k');
    expect(allowed.allowed).toBe(true);
  });

  it('keys are independent', () => {
    const clock = new FakeClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }, clock);
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
  });
});
