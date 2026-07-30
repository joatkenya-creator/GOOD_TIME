import 'server-only';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { CACHE_SECONDS } from '@/constants';

/**
 * Two caching layers, easily confused, so both are wrapped here with names that
 * say which one you are getting:
 *
 *   `perRequest`  — React's request memo. Deduplicates identical calls inside a
 *                   single render pass. Nothing crosses a request boundary.
 *   `persistent`  — Next's data cache. Survives across requests and deploys until
 *                   its TTL expires or one of its tags is revalidated.
 *
 * Rule of thumb: catalogue reads are `persistent`; anything derived from the
 * session is `perRequest` only. Caching per-user data persistently is how one
 * customer ends up seeing another customer's cart.
 */

/** React `cache` — request-scoped memoisation. Safe for session-dependent reads. */
export const perRequest = cache;

interface PersistentOptions {
  /** Stable cache key parts. Must include every argument that changes the result. */
  key: string[];
  tags: string[];
  /** Seconds before the entry is considered stale. */
  revalidate?: number;
}

/**
 * Wraps a data loader in Next's persistent data cache.
 *
 * Never pass a function that closes over `headers()`, `cookies()` or the session —
 * the result would be shared between users.
 */
export function persistent<Args extends unknown[], Result>(
  loader: (...args: Args) => Promise<Result>,
  options: PersistentOptions,
): (...args: Args) => Promise<Result> {
  return unstable_cache(loader, options.key, {
    tags: options.tags,
    revalidate: options.revalidate ?? CACHE_SECONDS.fiveMinutes,
  });
}

/**
 * `Cache-Control` presets for route handlers.
 *
 * `sMaxAge` + `staleWhileRevalidate` is what keeps the CDN serving instantly under
 * a traffic spike while a single origin request refreshes the entry.
 */
export const cacheControl = {
  /** Personalised or authenticated responses. Never cached anywhere. */
  private: 'private, no-store',
  /** Catalogue reads: fresh for a minute, stale-served for a day. */
  catalogue: `public, s-maxage=${CACHE_SECONDS.minute}, stale-while-revalidate=${CACHE_SECONDS.day}`,
  /** Rarely-changing content: settings, CMS pages. */
  static: `public, s-maxage=${CACHE_SECONDS.hour}, stale-while-revalidate=${CACHE_SECONDS.week}`,
  /** Immutable, content-addressed assets. */
  immutable: 'public, max-age=31536000, immutable',
} as const;
