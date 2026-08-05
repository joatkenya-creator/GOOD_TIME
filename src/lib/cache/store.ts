import 'server-only';

import { Redis } from '@upstash/redis';

import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * The application cache.
 *
 * ## Upstash over the wire, memory as the fallback
 *
 * Upstash speaks HTTP, not the Redis wire protocol, and that is the reason it
 * is here rather than a `redis://` client: the Cloudflare Workers runtime has
 * no raw TCP sockets, so `ioredis` cannot open a connection from the edge at
 * all. A REST call is the only shape that works in every place this code runs —
 * a local `next dev`, a CI job, and an isolate in Sydney.
 *
 * `UPSTASH_REDIS_REST_URL` set → Upstash. Unset → an in-process LRU. Every call
 * site is identical either way, so a local clone runs with no extra service and
 * a fleet gets a shared cache by setting two variables.
 *
 * The fallback is a real cache, not a stub. Most of what gets cached here — a
 * facet count, a synonym table, a rendered feed — is per-instance derivable and
 * cheap to recompute, so a cold local cache costs a query, not correctness.
 * What it deliberately does *not* do is pretend to be shared: `invalidate` on
 * one instance cannot clear another's memory, which is exactly why the entries
 * carry short TTLs and why anything correctness-critical uses the database.
 *
 * ## Why not `unstable_cache` for all of it
 *
 * Next's cache is keyed to the render and invalidated by tag, which is right
 * for page data and useless for "remember this supplier's auth token for nine
 * minutes" or "count these facets once a minute for every visitor". Both exist;
 * `lib/cache/cached.ts` wraps Next's, this is for everything else.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

/** Bounded so a runaway key pattern cannot exhaust the heap. */
const MAX_ENTRIES = 5000;

const memory = new Map<string, Entry>();

/** Lazily created: constructing it eagerly would run on every cold start. */
let redis: Redis | null = null;

function client(): Redis | null {
  if (!integrations.upstash) return null;

  redis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
    /*
     * Two retries with backoff. A cache is not worth a long stall on the
     * request path — past this we fall through to recomputing, which is slower
     * than a hit and faster than waiting for a service that is down.
     */
    retry: { retries: 2, backoff: (attempt) => Math.min(2 ** attempt * 50, 500) },
    /*
     * Upstash's client JSON-parses response bodies by default and hands back
     * whatever it guesses. We store JSON strings ourselves so the round-trip is
     * exactly what was written — no silent number/string coercion on read.
     */
    automaticDeserialization: false,
  });

  return redis;
}

function evictIfFull(): void {
  if (memory.size < MAX_ENTRIES) return;

  // Drop the oldest insertion. Map preserves insertion order, which makes this
  // FIFO rather than true LRU — enough for a bounded scratch cache, and it
  // costs no bookkeeping on the read path.
  const oldest = memory.keys().next().value;
  if (oldest !== undefined) memory.delete(oldest);
}

export async function get<T>(key: string): Promise<T | null> {
  const store = client();

  if (store) {
    try {
      const raw = await store.get<string>(key);
      return raw == null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      logger.warn('cache.get_failed', { key, reason: String(error) });
      return null;
    }
  }

  const entry = memory.get(key);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }

  return entry.value as T;
}

export async function set(
  key: string,
  value: unknown,
  ttlSeconds = 60,
  tags: string[] = [],
): Promise<void> {
  const store = client();

  if (store) {
    try {
      /*
       * One pipeline, not N round trips.
       *
       * Every command here is an HTTP request on its own, and a product page
       * writing four tagged keys would otherwise pay four times the latency.
       * Tag membership lives in a set per tag so invalidation is one lookup
       * rather than a `SCAN` across the whole keyspace.
       *
       * The tag sets get a TTL of their own — a generous multiple of the
       * entry's — because without one they accumulate dead key names forever
       * and eventually a single `invalidate` deletes ten thousand keys that
       * expired last month.
       */
      const pipeline = store.pipeline();
      pipeline.set(key, JSON.stringify(value), { ex: ttlSeconds });

      for (const tag of tags) {
        pipeline.sadd(`tag:${tag}`, key);
        pipeline.expire(`tag:${tag}`, Math.max(ttlSeconds * 4, 3600));
      }

      await pipeline.exec();
    } catch (error) {
      logger.warn('cache.set_failed', { key, reason: String(error) });
    }
    return;
  }

  evictIfFull();
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, tags });
}

/** Read-through. The shape almost every caller actually wants. */
export async function remember<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
  tags: string[] = [],
): Promise<T> {
  const cached = await get<T>(key);
  if (cached !== null) return cached;

  const value = await compute();
  await set(key, value, ttlSeconds, tags);
  return value;
}

export async function del(key: string): Promise<void> {
  const store = client();

  if (store) {
    await store.del(key).catch(() => undefined);
    return;
  }

  memory.delete(key);
}

/** Drops everything carrying a tag. */
export async function invalidate(tag: string): Promise<number> {
  const store = client();

  if (store) {
    try {
      const members = await store.smembers<string[]>(`tag:${tag}`);
      // `del` with no arguments is an error, not a no-op.
      if (members.length > 0) await store.del(...members);
      await store.del(`tag:${tag}`);
      return members.length;
    } catch (error) {
      logger.warn('cache.invalidate_failed', { tag, reason: String(error) });
      return 0;
    }
  }

  let removed = 0;
  for (const [key, entry] of memory) {
    if (entry.tags.includes(tag)) {
      memory.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** For tests and the admin's "clear cache" button. */
export async function clear(): Promise<void> {
  memory.clear();
}

export interface CacheStatus {
  driver: 'upstash' | 'memory';
  entries: number | null;
  /** Present only for the in-memory driver, where the ceiling is real. */
  maxEntries: number | null;
  /** Round-trip to the cache, in ms. `null` for the in-process driver. */
  latencyMs: number | null;
  reachable: boolean;
}

export async function status(): Promise<CacheStatus> {
  const store = client();

  if (!store) {
    return {
      driver: 'memory',
      entries: memory.size,
      maxEntries: MAX_ENTRIES,
      latencyMs: null,
      reachable: true,
    };
  }

  const startedAt = Date.now();

  try {
    await store.ping();
    return {
      driver: 'upstash',
      entries: null,
      maxEntries: null,
      latencyMs: Date.now() - startedAt,
      reachable: true,
    };
  } catch {
    return {
      driver: 'upstash',
      entries: null,
      maxEntries: null,
      latencyMs: Date.now() - startedAt,
      reachable: false,
    };
  }
}

/**
 * Namespaced key builders, so two features cannot collide by accident.
 *
 * ## TTLs
 *
 * The value is not encoded here because the right TTL depends on what the
 * caller is doing, but the house rules are:
 *
 *   - **Search and facets: 60s.** Derived, cheap to recompute, and a stale
 *     facet count is invisible to a customer.
 *   - **Product cards: 300s, tagged.** Invalidated by name on every write, so
 *     the TTL is only a backstop against a missed invalidation.
 *   - **Settings and marketing tags: 300s.** Changed by hand, read on every
 *     render; a merchant flipping a pixel on should see it within a coffee.
 *   - **Feeds: 3600s.** Regenerated by a job, consumed by a crawler, and
 *     nobody is waiting on it.
 *   - **Sessions: the session's own lifetime.** Never longer.
 */
export const keys = {
  facets: (categoryId: string) => `facets:${categoryId}`,
  search: (term: string, filters: string) => `search:${term}:${filters}`,
  suggest: (term: string) => `suggest:${term}`,
  synonyms: () => 'search:synonyms',
  productCard: (id: string) => `product:card:${id}`,
  merchantFeed: () => 'feed:merchant',
  settings: () => 'settings:all',
  marketing: () => 'marketing:integrations',
  session: (sessionId: string) => `session:${sessionId}`,
  apiResponse: (route: string, fingerprint: string) => `api:${route}:${fingerprint}`,
};

/** Recommended TTLs, so the numbers live in one place rather than thirty. */
export const TTL = {
  search: 60,
  facets: 60,
  productCard: 300,
  settings: 300,
  marketing: 300,
  feed: 3600,
  apiResponse: 30,
} as const;
