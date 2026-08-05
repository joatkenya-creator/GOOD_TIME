import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Rate limiting.
 *
 * ## Why this had to become shared state
 *
 * The previous implementation counted in process memory. That is correct and
 * free on one instance and quietly wrong on any number greater than one: each
 * isolate keeps its own counter, so the effective limit is `limit × instances`.
 * On Cloudflare Workers, where a request can land in any of hundreds of
 * isolates worldwide, "60 requests a minute" became "60 per isolate per
 * minute", which is not a limit at all.
 *
 * Upstash's sliding-window limiter is one shared counter, evaluated in a Lua
 * script so the read-modify-write cannot race. Sliding rather than fixed window
 * because a fixed window lets a caller send `2 × limit` across a window
 * boundary — the full allowance at 11:59:59 and again at 12:00:00.
 *
 * ## The fallback is honest about what it is
 *
 * With Upstash unconfigured this falls back to the in-process counter, logs
 * that it has done so once, and `productionReadiness()` reports it missing. The
 * fallback exists so a fresh clone runs; it is not a deployment target.
 *
 * ## What it does not defend against
 *
 * A distributed attacker with many source addresses. That is Cloudflare's WAF
 * and bot management doing their job in front of this — see docs/cloudflare.md.
 * This layer stops one client hammering one endpoint.
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the current window rolls over. */
  reset: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window. Defaults to `RATE_LIMIT_MAX`. */
  limit?: number;
  /** Window length in seconds. Defaults to `RATE_LIMIT_WINDOW_SECONDS`. */
  windowSeconds?: number;
}

// --- Shared limiter ---------------------------------------------------------

let redis: Redis | null = null;

/**
 * One `Ratelimit` per (limit, window) pair.
 *
 * Constructing one per call would allocate on every request and throw away the
 * ephemeral cache that lets an already-blocked caller be rejected without a
 * round trip.
 */
const limiters = new Map<string, Ratelimit>();

/**
 * Denials are cached in memory for the rest of the window.
 *
 * Once a caller is over the limit, asking Upstash again on every request pays
 * network latency to learn something already known — and under an actual flood
 * that is exactly when the extra requests hurt most.
 */
const ephemeral = new Map<string, number>();

function limiter(limit: number, windowSeconds: number): Ratelimit | null {
  if (!integrations.upstash) return null;

  const key = `${limit}:${windowSeconds}`;
  const existing = limiters.get(key);
  if (existing) return existing;

  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });

  const created = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    // Namespaced so the limiter's keys cannot collide with cache keys.
    prefix: 'rl',
    ephemeralCache: ephemeral,
    /*
     * Analytics off. It writes a second set of keys per request for a dashboard
     * nobody reads here — the numbers that matter are already in `metrics.ts`
     * and in Cloudflare's own analytics.
     */
    analytics: false,
  });

  limiters.set(key, created);
  return created;
}

// --- In-process fallback ----------------------------------------------------

interface Bucket {
  count: number;
  reset: number;
}

const buckets = new Map<string, Bucket>();

/** Bounded so a burst of unique identifiers cannot exhaust memory. */
const MAX_TRACKED_KEYS = 50_000;
let warnedAboutFallback = false;

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}

function inProcess(identifier: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size >= MAX_TRACKED_KEYS) evictExpired(now);

  const existing = buckets.get(identifier);
  const bucket = existing && existing.reset > now ? existing : { count: 0, reset: now + windowMs };

  bucket.count += 1;
  buckets.set(identifier, bucket);

  return {
    success: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    reset: bucket.reset,
  };
}

/**
 * Consumes one token for `identifier`.
 *
 * Bucket names should be namespaced by route class so a burst of product reads
 * cannot lock a user out of sign-in: `rateLimit(`auth:${ip}`)`.
 */
export async function rateLimit(
  identifier: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = options.limit ?? env.RATE_LIMIT_MAX;
  const windowSeconds = options.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS;

  const shared = limiter(limit, windowSeconds);

  if (!shared) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      logger.warn('ratelimit.in_process_fallback', {
        detail: 'UPSTASH_REDIS_REST_URL is unset; limits are per-instance.',
      });
    }
    return inProcess(identifier, limit, windowSeconds * 1000);
  }

  try {
    const result = await shared.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: Math.max(0, result.remaining),
      reset: result.reset,
    };
  } catch (error) {
    /*
     * Fail open, loudly.
     *
     * A rate limiter that cannot reach its store has two options and both are
     * bad: reject everything, turning an Upstash blip into a full site outage;
     * or allow everything, removing the limit until it recovers. Allowing is
     * the lesser harm because Cloudflare's WAF is still in front of this, and
     * the error log is what makes it a known degradation rather than a silent
     * one.
     */
    logger.error('ratelimit.store_unavailable', error, { identifier });
    return { success: true, limit, remaining: limit, reset: Date.now() + windowSeconds * 1000 };
  }
}

/** Standard headers so clients can back off politely. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const resetSeconds = Math.max(0, Math.ceil((result.reset - Date.now()) / 1_000));

  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(resetSeconds),
    // The one header every HTTP client already knows how to obey.
    ...(result.success ? {} : { 'Retry-After': String(resetSeconds) }),
  };
}

/**
 * Client identity for rate limiting.
 *
 * `CF-Connecting-IP` first: Cloudflare sets it from the TCP peer and a client
 * cannot forge it, whereas `x-forwarded-for` is a header anyone can send.
 * Behind Cloudflare, `x-forwarded-for` is trustworthy only in its first
 * position and only because Cloudflare rewrites it — reading it when
 * `CF-Connecting-IP` exists is how limiters get bypassed with one extra header.
 */
export function clientIdentifier(request: Request): string {
  const cloudflare = request.headers.get('cf-connecting-ip');
  if (cloudflare) return cloudflare;

  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/** Test seam: drops all in-process state. Never call this from application code. */
export function __resetRateLimitState(): void {
  buckets.clear();
  ephemeral.clear();
  limiters.clear();
  warnedAboutFallback = false;
}
