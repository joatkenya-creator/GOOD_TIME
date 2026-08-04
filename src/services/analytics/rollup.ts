import 'server-only';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Daily aggregation.
 *
 * A dashboard that scans the raw event table works beautifully at ten thousand
 * rows and falls over at ten million — and ten million is a few weeks of a busy
 * shop. The rollup writes one row per day per metric; the dashboard reads
 * those, so its cost stays flat no matter how much traffic accumulates behind
 * it.
 *
 * Every rollup is an upsert keyed on `(day, metric, dimension)`, so re-running
 * a day is safe and idempotent. That matters because the schedule deliberately
 * re-runs yesterday: events arriving late — a mobile client that was offline, a
 * webhook that retried — would otherwise be counted in no day at all.
 */

interface RollupResult {
  days: number;
  metrics: number;
  elapsedMs: number;
}

/** `metric` values the dashboard knows how to read. */
const METRICS = {
  pageViews: 'page_views',
  productViews: 'product_views',
  searches: 'searches',
  addToCart: 'add_to_cart',
  checkouts: 'begin_checkout',
  purchases: 'purchases',
  revenue: 'revenue',
  sessions: 'sessions',
} as const;

function dayBounds(offsetDays: number): { start: Date; end: Date } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - offsetDays);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

/**
 * Writes one rollup row.
 *
 * `dimension` is an empty string rather than null for the undimensioned
 * metrics. Postgres treats NULLs as distinct in a unique index, so a nullable
 * dimension would let the same metric be inserted for the same day over and
 * over — the upsert would never find its own previous row, and every re-run
 * would double the numbers.
 */
async function upsert(
  day: Date,
  metric: string,
  dimension: string | null,
  value: number,
  valueCents = 0,
): Promise<void> {
  const key = dimension ?? '';

  await prisma.analyticsDaily.upsert({
    where: { day_metric_dimension: { day, metric, dimension: key } },
    update: { value, valueCents },
    create: { day, metric, dimension: key, value, valueCents },
  });
}

/**
 * Aggregates the last `days` days.
 *
 * Runs one grouped query per shape rather than one per metric: five aggregates
 * over the same day partition is five index scans, and doing it per metric
 * would be twenty.
 */
export async function rollupDays(days = 1): Promise<RollupResult> {
  const started = Date.now();
  let metrics = 0;

  for (let offset = 0; offset < Math.max(1, Math.min(days, 90)); offset += 1) {
    const { start, end } = dayBounds(offset);
    const window = { createdAt: { gte: start, lt: end } };

    const [byName, sessions, revenue, byDevice, bySource, topProducts] = await Promise.all([
      prisma.analyticsEvent.groupBy({
        by: ['name'],
        where: window,
        _count: { _all: true },
      }),

      // `distinct on` is what makes this a session count rather than an event
      // count; Prisma has no groupBy-distinct, so it is raw SQL.
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "sessionId") AS count
        FROM "analytics_events"
        WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      `,

      prisma.analyticsEvent.aggregate({
        where: { ...window, name: 'purchase' },
        _sum: { valueCents: true },
        _count: { _all: true },
      }),

      prisma.analyticsEvent.groupBy({
        by: ['device'],
        where: { ...window, name: 'page_view' },
        _count: { _all: true },
      }),

      prisma.analyticsEvent.groupBy({
        by: ['medium'],
        where: { ...window, name: 'page_view' },
        _count: { _all: true },
      }),

      prisma.analyticsEvent.groupBy({
        by: ['productId'],
        where: { ...window, name: 'product_view', productId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { productId: 'desc' } },
        take: 50,
      }),
    ]);

    const countOf = (name: string) => byName.find((row) => row.name === name)?._count._all ?? 0;

    await upsert(start, METRICS.pageViews, null, countOf('page_view'));
    await upsert(start, METRICS.productViews, null, countOf('product_view'));
    await upsert(start, METRICS.searches, null, countOf('search'));
    await upsert(start, METRICS.addToCart, null, countOf('add_to_cart'));
    await upsert(start, METRICS.checkouts, null, countOf('begin_checkout'));
    await upsert(start, METRICS.purchases, null, revenue._count._all);
    await upsert(start, METRICS.revenue, null, revenue._count._all, revenue._sum.valueCents ?? 0);
    await upsert(start, METRICS.sessions, null, Number(sessions[0]?.count ?? 0));
    metrics += 8;

    for (const row of byDevice) {
      await upsert(start, 'device', row.device ?? 'unknown', row._count._all);
      metrics += 1;
    }

    for (const row of bySource) {
      await upsert(start, 'medium', row.medium ?? 'unknown', row._count._all);
      metrics += 1;
    }

    for (const row of topProducts) {
      if (!row.productId) continue;
      await upsert(start, 'product_views_by_product', row.productId, row._count._all);
      metrics += 1;
    }
  }

  const elapsedMs = Date.now() - started;
  logger.info('analytics.rolled_up', { days, metrics, elapsedMs });

  return { days, metrics, elapsedMs };
}

/**
 * Deletes raw events past the retention window.
 *
 * The rollups are permanent and tiny; the raw rows are for drill-down and get
 * expensive. 400 days by default so a year-on-year comparison still has
 * something to compare, and deleting in batches so a year of accumulated rows
 * does not lock the table while it goes.
 */
export async function pruneEvents(olderThanDays = 400): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  let deleted = 0;

  for (;;) {
    // `deleteMany` with a limit is not expressible in Prisma, so the batch is
    // selected first. A single unbounded delete of several million rows is a
    // long-held lock and a very unhappy replica.
    const batch = await prisma.analyticsEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: 5000,
    });

    if (batch.length === 0) break;

    const result = await prisma.analyticsEvent.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });

    deleted += result.count;
    if (batch.length < 5000) break;
  }

  logger.info('analytics.pruned', { deleted, olderThanDays });
  return { deleted };
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  value: number;
  valueCents: number;
}

/** A metric's daily series, straight from the rollups. */
export async function trend(metric: string, days = 30): Promise<TrendPoint[]> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - days);

  const rows = await prisma.analyticsDaily.findMany({
    where: { metric, dimension: '', day: { gte: from } },
    orderBy: { day: 'asc' },
    select: { day: true, value: true, valueCents: true },
  });

  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    value: row.value,
    valueCents: row.valueCents,
  }));
}

export interface FunnelStep {
  step: string;
  label: string;
  count: number;
  /** Share of the step before it. The number that shows where people leave. */
  conversionFromPrevious: number | null;
}

/**
 * The checkout funnel, counted in sessions rather than events.
 *
 * Someone who views four products and adds two to their cart is one session at
 * each step. Counting events instead reports a conversion rate above 100% and
 * teaches everyone to distrust the dashboard.
 */
export async function funnel(days = 30): Promise<FunnelStep[]> {
  const from = new Date(Date.now() - days * 86_400_000);

  const steps = [
    { step: 'page_view', label: 'Visited' },
    { step: 'product_view', label: 'Viewed a product' },
    { step: 'add_to_cart', label: 'Added to cart' },
    { step: 'begin_checkout', label: 'Started checkout' },
    { step: 'add_payment_info', label: 'Entered payment' },
    { step: 'purchase', label: 'Purchased' },
  ];

  const counts = await prisma.$queryRaw<{ name: string; sessions: bigint }[]>`
    SELECT "name", COUNT(DISTINCT "sessionId") AS sessions
    FROM "analytics_events"
    WHERE "createdAt" >= ${from}
    GROUP BY "name"
  `;

  const byName = new Map(counts.map((row) => [row.name, Number(row.sessions)]));

  let previous: number | null = null;

  return steps.map((step) => {
    const count = byName.get(step.step) ?? 0;
    const conversion = previous && previous > 0 ? Math.round((count / previous) * 1000) / 10 : null;
    previous = count || previous;

    return { ...step, count, conversionFromPrevious: conversion };
  });
}

/** Traffic split by a dimension, for the source and device panels. */
export async function breakdown(
  metric: 'device' | 'medium',
  days = 30,
): Promise<{ label: string; value: number; share: number }[]> {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - days);

  const rows = await prisma.analyticsDaily.groupBy({
    by: ['dimension'],
    where: { metric, day: { gte: from } },
    _sum: { value: true },
    orderBy: { _sum: { value: 'desc' } },
  });

  const total = rows.reduce((sum, row) => sum + (row._sum.value ?? 0), 0);

  return rows.map((row) => ({
    label: row.dimension ?? 'unknown',
    value: row._sum.value ?? 0,
    share: total > 0 ? Math.round(((row._sum.value ?? 0) / total) * 1000) / 10 : 0,
  }));
}

/**
 * Customer lifetime value, from orders rather than events.
 *
 * Money questions are answered from the orders table, always. Analytics events
 * are best-effort — a blocked request, a closed tab mid-beacon — and revenue
 * reporting has to reconcile with what was actually charged.
 */
export async function lifetimeValue(): Promise<{
  averageCents: number;
  medianCents: number;
  topDecileCents: number;
  customers: number;
}> {
  const rows = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT SUM("totalCents")::bigint AS total
    FROM "orders"
    WHERE "userId" IS NOT NULL
      AND "status" IN ('PAID','CONFIRMED','PROCESSING','SHIPPED','DELIVERED')
    GROUP BY "userId"
    ORDER BY total ASC
  `;

  if (rows.length === 0) {
    return { averageCents: 0, medianCents: 0, topDecileCents: 0, customers: 0 };
  }

  const values = rows.map((row) => Number(row.total));
  const sum = values.reduce((total, value) => total + value, 0);

  // Median and the top decile, not just the mean: one wholesale-sized order
  // drags an average somewhere no real customer lives.
  const median = values[Math.floor(values.length / 2)] ?? 0;
  const decile = values[Math.floor(values.length * 0.9)] ?? 0;

  return {
    averageCents: Math.round(sum / values.length),
    medianCents: median,
    topDecileCents: decile,
    customers: values.length,
  };
}
