import 'server-only';

import { logger } from '@/lib/logger';

/**
 * The application cache.
 *
 * ## Redis is optional, not assumed
 *
 * `REDIS_URL` set → Redis. Unset → an in-process LRU. Every call site is
 * identical either way, so a single instance runs with no extra service and a
 * fleet gets a shared cache by setting one variable.
 *
 * The fallback is a real cache, not a stub. Most of what gets cached here —
 * a facet count, a synonym table, a rendered feed — is per-instance derivable
 * and cheap to recompute, so a cold local cache costs a query, not correctness.
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

/** Lazily-created Redis client, if the dependency and the URL are both present. */
let redis: RedisLike | null = null;
let redisChecked = false;

/** The three commands used here, so any client library satisfies it. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

async function client(): Promise<RedisLike | null> {
  if (redisChecked) return redis;
  redisChecked = true;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    /*
     * Imported by name through a variable so bundlers do not try to resolve it
     * at build time. Redis is an optional peer: the platform must build and run
     * without it installed, and a static import would make it mandatory.
     */
    const moduleName = 'ioredis';
    const { default: Redis } = (await import(/* webpackIgnore: true */ moduleName)) as {
      default: new (url: string, options?: Record<string, unknown>) => RedisLike;
    };

    redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    logger.info('cache.redis_connected');
  } catch (error) {
    // Falling back is correct: a cache that cannot connect must not take the
    // application down with it.
    logger.warn('cache.redis_unavailable', {
      reason: error instanceof Error ? error.message : String(error),
    });
    redis = null;
  }

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
  const store = await client();

  if (store) {
    try {
      const raw = await store.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
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
  const store = await client();

  if (store) {
    try {
      await store.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      // Tag membership lives in a set per tag, so invalidation is one lookup
      // rather than a `KEYS *` scan across the whole keyspace.
      for (const tag of tags) await store.sadd(`tag:${tag}`, key);
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
  const store = await client();

  if (store) {
    await store.del(key).catch(() => undefined);
    return;
  }

  memory.delete(key);
}

/** Drops everything carrying a tag. */
export async function invalidate(tag: string): Promise<number> {
  const store = await client();

  if (store) {
    try {
      const keys = await store.smembers(`tag:${tag}`);
      if (keys.length > 0) await store.del(...keys);
      await store.del(`tag:${tag}`);
      return keys.length;
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
  driver: 'redis' | 'memory';
  entries: number | null;
  /** Present only for the in-memory driver, where the ceiling is real. */
  maxEntries: number | null;
}

export async function status(): Promise<CacheStatus> {
  const store = await client();

  return store
    ? { driver: 'redis', entries: null, maxEntries: null }
    : { driver: 'memory', entries: memory.size, maxEntries: MAX_ENTRIES };
}

/** Namespaced key builders, so two features cannot collide by accident. */
export const keys = {
  facets: (categoryId: string) => `facets:${categoryId}`,
  search: (term: string, filters: string) => `search:${term}:${filters}`,
  suggest: (term: string) => `suggest:${term}`,
  synonyms: () => 'search:synonyms',
  productCard: (id: string) => `product:card:${id}`,
  merchantFeed: () => 'feed:merchant',
  settings: () => 'settings:all',
  marketing: () => 'marketing:integrations',
};
