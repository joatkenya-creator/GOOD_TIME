import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue';
import doShardedTagCache from '@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache';

/**
 * OpenNext → Cloudflare Workers.
 *
 * Three storage decisions, each with a failure mode worth naming.
 *
 * ## Incremental cache: KV for now, R2 as soon as it is enabled
 *
 * R2 is the right answer and this file used to say so: KV is eventually
 * consistent, with global write propagation measured in tens of seconds, so a
 * revalidated product page can be live in London and stale in Sydney — and the
 * customer seeing the stale one is looking at a price we are not going to
 * honour. R2 is strongly consistent read-after-write, and a few milliseconds on
 * a cache miss is a straightforward trade for never serving two prices at once.
 *
 * KV is here because R2 is not enabled on the account yet and the deploy cannot
 * bind a bucket that does not exist. This is a deliberate, temporary downgrade:
 * the window is seconds, it only affects a page in the moment after it is
 * revalidated, and it is strictly better than the alternative of no incremental
 * cache at all — which would re-render every page on every request and spend
 * CPU the free plan does not have.
 *
 * ponytail: KV incremental cache, revert to `r2IncrementalCache` the day R2 is
 * enabled — swap this import back and restore the `r2_buckets` binding in
 * wrangler.jsonc. Both are marked.
 *
 * ## Revalidation queue: a Durable Object
 *
 * This is what stops a cache stampede. When a popular page's cache expires, a
 * hundred concurrent requests each want to regenerate it — a hundred identical
 * database reads producing one result, at exactly the moment the page is
 * busiest. The Durable Object gives revalidation a single owner, so the first
 * request regenerates and the other ninety-nine wait for it.
 *
 * ## Tag cache: sharded, replicated, regionally cached
 *
 * `revalidateTag('products')` has to find every cached entry carrying that tag.
 * Unsharded, one Durable Object serialises every tag read on the site through
 * a single location, and a customer in Sydney pays a round trip to wherever it
 * happens to live. Three dials, doing three different jobs:
 *
 *   - **Sharding** spreads tags across objects, so hot tags do not queue behind
 *     each other. The cost is fan-out: a page with five tags may touch up to
 *     five shards.
 *   - **Replication** adds capacity per shard for read load. Writes go to every
 *     replica, which is what keeps invalidation correct rather than merely fast.
 *   - **Regional cache** keeps recent lookups near the reader. Its TTL is the
 *     lag between calling `revalidateTag` and the page actually changing, which
 *     is why it stays low.
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,

  queue: doQueue,

  tagCache: doShardedTagCache({
    /**
     * Eight shards.
     *
     * Enough to spread the load, small enough that `revalidateTag` still only
     * fans out to eight objects. More shards means more parallel writes per
     * invalidation, which is the cost side of this dial.
     */
    baseShardSize: 8,

    /**
     * Replicas per shard, for read capacity under load.
     *
     * Soft tags (Next's own, behind `revalidatePath`) outnumber hard tags
     * heavily, so they get the extra replica. Writes apply to every replica, so
     * this buys read throughput at the cost of write fan-out — the right way
     * round for a catalogue that is read far more often than it is edited.
     */
    shardReplication: { numberOfSoftReplicas: 2, numberOfHardReplicas: 1 },

    /**
     * A short-lived per-region cache in front of the shards.
     *
     * A tag lookup sits on the hot path of every cached page render, and
     * without this every one of them crosses the network to a Durable Object.
     * The TTL is the price: it is how long `revalidateTag` can take to visibly
     * apply, so five seconds is deliberate — long enough to collapse a burst of
     * identical lookups, short enough that an admin publishing a price change
     * does not think it failed.
     */
    regionalCache: true,
    regionalCacheTtlSec: 5,
  }),
});
