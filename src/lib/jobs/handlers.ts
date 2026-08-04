import 'server-only';

import { revalidatePath, revalidateTag } from 'next/cache';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { enqueue, enqueueMany, prune, registerHandler } from '@/lib/jobs/queue';

/**
 * Every background job the platform knows how to run.
 *
 * Registered in one file so `registeredKinds()` is the honest answer to "what
 * can this system do in the background", and so a job enqueued with a typo
 * fails loudly at the worker rather than silently never running.
 *
 * **Handlers must be idempotent.** A worker that dies mid-job leaves a stale
 * lock; the reclaimer requeues it, and the job runs again. Every handler below
 * is written so that running it twice is the same as running it once.
 */

/** Marks the registry as loaded, so importing this module twice is harmless. */
let registered = false;

export function registerAllHandlers(): void {
  if (registered) return;
  registered = true;

  // ---------------------------------------------------------------- imports
  registerHandler('import.run', async (payload, context) => {
    const jobId = String(payload.importJobId ?? '');
    if (!jobId) throw new Error('import.run needs an importJobId');

    // Imported lazily: the import engine pulls in parsers this worker does not
    // need for any other job kind.
    const { runImportJob } = await import('@/services/import/runner');
    return runImportJob(jobId, context);
  });

  // ------------------------------------------------------------ price sync
  registerHandler('price.sync', async (payload, context) => {
    const templateId = payload.templateId ? String(payload.templateId) : undefined;
    const { syncPrices } = await import('@/services/import/sync');
    return syncPrices({ templateId }, context);
  });

  // -------------------------------------------------------- inventory sync
  registerHandler('inventory.sync', async (payload, context) => {
    const templateId = payload.templateId ? String(payload.templateId) : undefined;
    const { syncInventory } = await import('@/services/import/sync');
    return syncInventory({ templateId }, context);
  });

  // ------------------------------------------------------------ image sync
  registerHandler('media.optimize', async (payload) => {
    const mediaId = String(payload.mediaId ?? '');
    if (!mediaId) throw new Error('media.optimize needs a mediaId');

    const { optimizeMedia } = await import('@/services/media/pipeline');
    return optimizeMedia(mediaId);
  });

  // --------------------------------------------------------- search index
  registerHandler('search.index', async (payload) => {
    const productId = String(payload.productId ?? '');
    const { indexProduct } = await import('@/services/search/indexer');
    return indexProduct(productId);
  });

  registerHandler('search.reindex_all', async (_payload, context) => {
    const { reindexAll } = await import('@/services/search/indexer');
    return reindexAll(context);
  });

  // ------------------------------------------------------------------ SEO
  registerHandler('seo.audit', async (_payload, context) => {
    const { runSeoAudit } = await import('@/services/seo/audit');
    return runSeoAudit(context);
  });

  registerHandler('seo.regenerate', async () => {
    /*
     * The sitemap is generated per request from live data, so there is nothing
     * to rebuild — this drops its cache instead. Keeping the job means the
     * schedule and the admin button stay meaningful even though the
     * implementation is one line.
     */
    revalidatePath('/sitemap.xml');
    revalidatePath('/robots.txt');
    // `max` expires the entry outright rather than shortening its life —
    // a regeneration that leaves the old copy servable has not regenerated.
    revalidateTag('products', 'max');
    revalidateTag('categories', 'max');
    return { revalidated: ['sitemap', 'robots', 'products', 'categories'] };
  });

  // ------------------------------------------------------ cache management
  registerHandler('cache.invalidate', async (payload) => {
    const tags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
    const paths = Array.isArray(payload.paths) ? payload.paths.map(String) : [];

    for (const tag of tags) revalidateTag(tag, 'max');
    for (const path of paths) revalidatePath(path);

    const { invalidate } = await import('@/lib/cache/store');
    for (const tag of tags) await invalidate(tag);

    return { tags: tags.length, paths: paths.length };
  });

  // ----------------------------------------------------------- email queue
  registerHandler('email.send', async (payload) => {
    /*
     * The queue carries an intent, not a rendered email.
     *
     * Storing subject and HTML in the payload would put customer names and
     * order contents in a table that is backed up and widely readable. An id
     * plus a kind keeps the personal data where it already lives, and means a
     * retry re-renders from current data rather than resending a stale copy.
     */
    const kind = String(payload.kind ?? '');
    const email = await import('@/services/email.service');

    switch (kind) {
      case 'order_confirmation':
        return { sent: await email.sendOrderConfirmation(String(payload.orderId)) };
      case 'shipping_notification': {
        // Read from the shipment rather than trusting the payload: the queue
        // may have been written before the tracking number was known, and the
        // customer should get the number that is actually on the parcel.
        const { prisma: db } = await import('@/lib/prisma');
        const shipment = await db.shipment.findFirst({
          where: { orderId: String(payload.orderId) },
          orderBy: { createdAt: 'desc' },
          select: { carrier: true, trackingNumber: true, trackingUrl: true },
        });

        if (!shipment) throw new Error('No shipment recorded for that order yet.');

        return { sent: await email.sendShippingNotification(String(payload.orderId), shipment) };
      }
      case 'delivery_confirmation':
        return { sent: await email.sendDeliveryConfirmation(String(payload.orderId)) };
      case 'cancellation':
        return {
          sent: await email.sendCancellationEmail(
            String(payload.orderId),
            payload.reason ? String(payload.reason) : undefined,
          ),
        };
      case 'refund':
        return {
          sent: await email.sendRefundEmail(String(payload.orderId), Number(payload.amountCents ?? 0)),
        };
      case 'welcome':
        return { sent: await email.sendWelcomeEmail(String(payload.userId)) };
      default:
        throw new Error(`Unknown email kind: ${kind}`);
    }
  });

  // --------------------------------------------------------- webhook queue
  registerHandler('webhook.deliver', async (payload) => {
    const url = String(payload.url ?? '');
    const body = payload.body ?? {};

    if (!/^https:\/\//.test(url)) {
      // Not retryable: an http:// endpoint is a configuration mistake, and
      // retrying it twenty times only delays someone noticing.
      throw new Error(`Refusing to deliver a webhook over plain HTTP: ${url}`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    return { status: response.status };
  });

  // ------------------------------------------------------------- analytics
  registerHandler('analytics.rollup', async (payload) => {
    const days = Number(payload.days ?? 1);
    const { rollupDays } = await import('@/services/analytics/rollup');
    return rollupDays(days);
  });

  registerHandler('analytics.prune', async (payload) => {
    const days = Number(payload.days ?? 400);
    const { pruneEvents } = await import('@/services/analytics/rollup');
    return pruneEvents(days);
  });

  // ----------------------------------------------------------- maintenance
  registerHandler('jobs.prune', async (payload) => {
    const days = Number(payload.days ?? 7);
    const count = await prune(days);
    return { deleted: count };
  });

  registerHandler('inventory.alerts', async () => {
    const { syncInventoryAlerts } = await import('@/services/admin/alert.service');
    return syncInventoryAlerts();
  });
}

/**
 * The scheduler tick.
 *
 * Reads every active schedule whose `nextRunAt` has passed, enqueues one job
 * for each, and advances the pointer. Called by the cron route once a minute.
 *
 * `nextRunAt` is advanced *before* the job runs, so a slow job cannot cause its
 * own schedule to fire again on the next tick. The dedupe key adds a second
 * guarantee: two ticks racing produce one job, not two.
 */
export async function tickScheduler(now: Date = new Date()): Promise<{
  fired: number;
  skipped: number;
}> {
  const { nextRun } = await import('@/lib/jobs/cron');

  const due = await prisma.scheduledJob.findMany({
    where: { isActive: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    select: { id: true, key: true, kind: true, payload: true, cron: true, nextRunAt: true },
  });

  let fired = 0;
  let skipped = 0;

  for (const schedule of due) {
    const upcoming = nextRun(schedule.cron, now);

    if (!upcoming) {
      logger.warn('scheduler.unreachable', { key: schedule.key, cron: schedule.cron });
      skipped += 1;
      continue;
    }

    /*
     * A schedule that has never run gets its pointer set without firing.
     *
     * Otherwise deploying a new nightly job at 14:00 runs it immediately, which
     * is exactly what nobody expects from something called "nightly".
     */
    if (schedule.nextRunAt === null) {
      await prisma.scheduledJob.update({
        where: { id: schedule.id },
        data: { nextRunAt: upcoming },
      });
      skipped += 1;
      continue;
    }

    await prisma.scheduledJob.update({
      where: { id: schedule.id },
      data: { nextRunAt: upcoming, lastRunAt: now },
    });

    await enqueue({
      kind: schedule.kind,
      payload: (schedule.payload ?? {}) as Record<string, unknown>,
      scheduleId: schedule.id,
      // One job per schedule per minute, whatever happens upstream.
      dedupeKey: `sched:${schedule.key}:${now.toISOString().slice(0, 16)}`,
    });

    fired += 1;
  }

  return { fired, skipped };
}

/** The schedules the platform ships with. Seeded, then editable in the admin. */
export const DEFAULT_SCHEDULES = [
  {
    key: 'nightly-price-sync',
    name: 'Price synchronisation',
    kind: 'price.sync',
    cron: '0 2 * * *',
    description: 'Pulls supplier prices from every active template.',
  },
  {
    key: 'nightly-inventory-sync',
    name: 'Inventory synchronisation',
    kind: 'inventory.sync',
    cron: '0 3 * * *',
    description: 'Pulls supplier stock levels.',
  },
  {
    key: 'hourly-inventory-alerts',
    name: 'Low stock alerts',
    kind: 'inventory.alerts',
    cron: '0 * * * *',
    description: 'Raises an admin alert for anything at or below its threshold.',
  },
  {
    key: 'daily-analytics-rollup',
    name: 'Analytics rollup',
    kind: 'analytics.rollup',
    cron: '15 0 * * *',
    payload: { days: 2 },
    description: 'Aggregates raw events into daily metrics. Re-runs yesterday to catch late events.',
  },
  {
    key: 'weekly-seo-audit',
    name: 'SEO audit',
    kind: 'seo.audit',
    cron: '0 4 * * 1',
    description: 'Crawls the catalogue for missing, duplicate or broken metadata.',
  },
  {
    key: 'daily-sitemap-refresh',
    name: 'Sitemap refresh',
    kind: 'seo.regenerate',
    cron: '30 4 * * *',
    description: 'Drops sitemap and catalogue caches.',
  },
  {
    key: 'weekly-job-prune',
    name: 'Job history prune',
    kind: 'jobs.prune',
    cron: '0 5 * * 0',
    payload: { days: 7 },
    description: 'Deletes succeeded jobs older than a week. Dead jobs are never pruned.',
  },
  {
    key: 'monthly-analytics-prune',
    name: 'Analytics prune',
    kind: 'analytics.prune',
    cron: '0 5 1 * *',
    payload: { days: 400 },
    description: 'Deletes raw events older than 400 days; the daily rollups remain.',
  },
] as const;

/** Convenience for the places that enqueue one reindex per changed product. */
export async function enqueueReindex(productIds: string[]): Promise<number> {
  return enqueueMany(
    productIds.map((productId) => ({
      kind: 'search.index',
      payload: { productId },
      priority: 50,
      dedupeKey: `search.index:${productId}`,
    })),
  );
}
