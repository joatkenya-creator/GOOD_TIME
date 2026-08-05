import { PERMISSIONS } from '@/constants/permissions';
import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { status as cacheStatus } from '@/lib/cache/store';
import { productionReadiness } from '@/lib/env';
import { isQueueAvailable } from '@/lib/jobs/cf-queue';
import { stats as queueStats } from '@/lib/jobs/queue';
import { snapshot } from '@/lib/monitoring/metrics';
import { prisma } from '@/lib/prisma';
import { assertAdminPermission } from '@/server/auth/admin';
import { searchEngine } from '@/services/search/engine';

/**
 * `GET /api/health/deep` — full system diagnostics.
 *
 * Separate from `/api/health` on purpose. That one is a liveness probe: fast,
 * public, and safe to hammer from an uptime monitor. This one enumerates
 * subsystems, queue depth and configuration, which is a map of the
 * installation — useful to an operator and useful to an attacker, so it needs
 * a permission.
 *
 * ## What "degraded" means here
 *
 * A subsystem is degraded when it is working but not as intended: the cache
 * falling back to memory, the queue draining slower than it fills, search
 * reachable but with an empty index. None of those return an error to a
 * customer, and all of them get worse if nobody is told.
 */
export const GET = withRoute(
  async () => {
    await assertAdminPermission(PERMISSIONS.settingsRead);

    const startedAt = Date.now();

    const [database, cache, queue, search, indexSize, deadJobs, pushDelivery] = await Promise.all([
      checkDatabase(),
      cacheStatus(),
      queueStats(),
      searchEngine().healthy(),
      prisma.productSearchDocument.count(),
      prisma.backgroundJob.count({ where: { status: 'DEAD' } }),
      isQueueAvailable(),
    ]);

    const readiness = productionReadiness();

    /*
     * The queue's health is its age, not its depth.
     *
     * A thousand jobs that drain in a minute is a busy shop. Ten that have
     * been waiting an hour means the workers are dead, and depth alone cannot
     * tell those apart.
     */
    const queueDegraded = (queue.oldestQueuedSeconds ?? 0) > 300 || deadJobs > 0;

    const checks = {
      database: {
        ok: database.reachable,
        latencyMs: database.latencyMs,
        detail: database.reachable ? null : 'Unreachable',
      },
      cache: {
        // A configured Upstash that cannot be reached *is* a failure: rate
        // limits silently fail open and every cached read becomes a query.
        ok: cache.reachable,
        driver: cache.driver,
        entries: cache.entries,
        latencyMs: cache.latencyMs,
        detail: !cache.reachable
          ? 'Upstash is configured but unreachable. Rate limits are failing open.'
          : cache.driver === 'memory'
            ? 'In-process fallback; UPSTASH_REDIS_REST_URL is unset. Limits are per-isolate.'
            : null,
      },
      queue: {
        ok: !queueDegraded,
        ...queue,
        deadLetter: deadJobs,
        /*
         * Push delivery is a latency optimisation, never a correctness one —
         * the cron sweep runs every minute regardless. So its absence is
         * reported, not failed: on `next dev` and in CI there is no Cloudflare
         * binding at all, and that is the expected state.
         */
        pushDelivery: pushDelivery ? 'cloudflare-queues' : 'cron-sweep-only',
        detail: queueDegraded
          ? deadJobs > 0
            ? `${deadJobs} jobs exhausted their retries.`
            : 'The oldest queued job has been waiting over five minutes.'
          : null,
      },
      search: {
        ok: search && indexSize > 0,
        engine: searchEngine().name,
        documents: indexSize,
        detail: indexSize === 0 ? 'The index is empty. Run a full reindex.' : null,
      },
      integrations: {
        klarna: Boolean(process.env.KLARNA_USERNAME),
        klarnaEnvironment: process.env.KLARNA_ENVIRONMENT ?? 'playground',
        email: Boolean(process.env.RESEND_API_KEY),
        cloudinary: Boolean(process.env.CLOUDINARY_API_KEY),
        upstash: Boolean(process.env.UPSTASH_REDIS_REST_URL),
        sentry: Boolean(process.env.SENTRY_DSN),
        turnstile: Boolean(process.env.TURNSTILE_SECRET_KEY),
        cron: Boolean(process.env.CRON_SECRET),
      },

      /*
       * The launch gate, reported live.
       *
       * The same list `npm run verify:production` prints, surfaced here so an
       * operator can answer "is anything unconfigured right now" without
       * shelling into a build. Deliberately not part of `failing` below: a
       * staging environment is *supposed* to be missing production
       * credentials, and marking it degraded for that would train people to
       * ignore this endpoint.
       */
      readiness: {
        ok: readiness.ready,
        missing: readiness.missing,
      },
    };

    const failing = Object.entries(checks)
      .filter(([, value]) => 'ok' in value && value.ok === false)
      .map(([name]) => name);

    return jsonOk(
      {
        status: failing.length === 0 ? 'ok' : 'degraded',
        failing,
        checks,
        metrics: snapshot(),
        elapsedMs: Date.now() - startedAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
  { rateLimit: { limit: 30, windowSeconds: 60 } },
);

async function checkDatabase(): Promise<{ reachable: boolean; latencyMs: number }> {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return { reachable: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { reachable: false, latencyMs: Date.now() - startedAt };
  }
}

export const dynamic = 'force-dynamic';
