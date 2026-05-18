import 'server-only';

// In-memory sliding-window rate limit. Per-process, which is fine for the v0
// single-instance deployment but documented in docs/intake/security.md as a
// known v0 limitation: a multi-replica deploy needs a shared store.

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export const DEFAULT_INTAKE_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 10
};

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetAtMs: number;
}

export interface Clock {
  now(): number;
}

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly config: RateLimitConfig = DEFAULT_INTAKE_RATE_LIMIT,
    private readonly clock: Clock = SYSTEM_CLOCK
  ) {}

  consume(key: string): RateLimitDecision {
    const now = this.clock.now();
    const cutoff = now - this.config.windowMs;
    const existing = this.windows.get(key) ?? [];
    const pruned = existing.filter((t) => t > cutoff);

    if (pruned.length >= this.config.maxRequests) {
      const oldest = pruned[0];
      const retryAfterMs = Math.max(0, oldest + this.config.windowMs - now);
      this.windows.set(key, pruned);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
        resetAtMs: oldest + this.config.windowMs
      };
    }

    pruned.push(now);
    this.windows.set(key, pruned);
    return {
      allowed: true,
      remaining: this.config.maxRequests - pruned.length,
      retryAfterMs: 0,
      resetAtMs: now + this.config.windowMs
    };
  }

  // Test-only: drop all state.
  reset(): void {
    this.windows.clear();
  }
}

let cached: SlidingWindowRateLimiter | null = null;

export function getIntakeRateLimiter(): SlidingWindowRateLimiter {
  if (!cached) cached = new SlidingWindowRateLimiter();
  return cached;
}

// Test-only: replace the singleton (e.g. with an injected clock).
export function __setIntakeRateLimiter(limiter: SlidingWindowRateLimiter | null): void {
  cached = limiter;
}

// Separate singleton for the /api/intake/email route. The email worker is
// single-tenant (one bearer token) so per-key segmentation isn't useful — we
// run the whole route on one bucket. Keeping this separate from the bearer
// limiter means a flooded email worker can't lock out legitimate /api/intake
// traffic and vice-versa.
export const EMAIL_INTAKE_BUCKET_KEY = 'email-worker';

let emailCached: SlidingWindowRateLimiter | null = null;

export function getEmailIntakeRateLimiter(): SlidingWindowRateLimiter {
  if (!emailCached) emailCached = new SlidingWindowRateLimiter();
  return emailCached;
}

export function __setEmailIntakeRateLimiter(limiter: SlidingWindowRateLimiter | null): void {
  emailCached = limiter;
}
