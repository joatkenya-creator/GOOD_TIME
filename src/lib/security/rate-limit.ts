import { env } from '@/lib/env';

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

interface Bucket {
  count: number;
  reset: number;
}

// ponytail: fixed-window counter in process memory. Correct and free for a single
// instance, but each serverless instance keeps its own counter, so the effective
// limit is `limit x instances`. Swap the two lines in `consume` for an Upstash
// Redis INCR/EXPIRE when traffic justifies it — the call sites do not change.
const buckets = new Map<string, Bucket>();

/** Bounded so a burst of unique identifiers cannot exhaust memory. */
const MAX_TRACKED_KEYS = 50_000;

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}

/**
 * Consumes one token for `identifier`.
 *
 * Bucket names should be namespaced by route class so a burst of product reads
 * cannot lock a user out of sign-in: `rateLimit(`auth:${ip}`)`.
 */
export function rateLimit(identifier: string, options: RateLimitOptions = {}): RateLimitResult {
  const limit = options.limit ?? env.RATE_LIMIT_MAX;
  const windowMs = (options.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1_000;
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

/** Standard headers so clients can back off politely. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil((result.reset - Date.now()) / 1_000)),
  };
}

/**
 * Best-effort client identity for rate limiting.
 *
 * Trusts `x-forwarded-for` because Vercel strips and rewrites it at the edge; do
 * not reuse this behind a proxy that forwards the header unvalidated.
 */
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}
