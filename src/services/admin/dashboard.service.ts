import 'server-only';

import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

/**
 * The executive dashboard.
 *
 * Every number here is real, computed from the same tables the storefront
 * sells from. Placeholder data on a dashboard is worse than an empty state: an
 * empty state says "no orders yet", invented figures say "revenue is $84,320"
 * to someone about to make a decision with it.
 *
 * The one exception is the sparkline shape when a store is brand new, and it
 * says so on the card rather than drawing a plausible curve.
 */

/** Statuses that represent money actually earned. */
const EARNING_STATUSES: OrderStatus[] = [
  'PAID',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysAgo(count: number): Date {
  return startOfDay(new Date(Date.now() - count * 86_400_000));
}

export interface DashboardMetric {
  label: string;
  value: string;
  /** Percentage against the previous equivalent window. Null when there is no base. */
  changePercent: number | null;
  hint: string;
}

/**
 * Headline figures, each against the previous equivalent window.
 *
 * A number without a comparison is trivia. "$12,400 today" means nothing until
 * you know yesterday was $8,000 — and comparing against the *same length* of
 * window is why "this month vs last month" on the 2nd is a lie everyone has
 * learned to ignore.
 */
export async function getDashboardMetrics() {
  const today = startOfDay(new Date());
  const last30 = daysAgo(30);
  const previous30 = daysAgo(60);

  const paid = { status: { in: EARNING_STATUSES } };

  const [
    revenue30,
    revenuePrevious30,
    orders30,
    ordersPrevious30,
    ordersToday,
    revenueToday,
    customers30,
    customersPrevious30,
    pendingOrders,
    refundRequests,
    lowStock,
    outOfStock,
  ] = await Promise.all([
    prisma.order.aggregate({ _sum: { totalCents: true }, where: { ...paid, placedAt: { gte: last30 } } }),
    prisma.order.aggregate({
      _sum: { totalCents: true },
      where: { ...paid, placedAt: { gte: previous30, lt: last30 } },
    }),
    prisma.order.count({ where: { placedAt: { gte: last30 } } }),
    prisma.order.count({ where: { placedAt: { gte: previous30, lt: last30 } } }),
    prisma.order.count({ where: { placedAt: { gte: today } } }),
    prisma.order.aggregate({ _sum: { totalCents: true }, where: { ...paid, placedAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: last30 } } }),
    prisma.user.count({ where: { createdAt: { gte: previous30, lt: last30 } } }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.returnRequest.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
    prisma.inventory.count({
      where: { policy: 'DENY', quantity: { gt: 0, lte: 5 } },
    }),
    prisma.inventory.count({ where: { policy: 'DENY', quantity: { lte: 0 } } }),
  ]);

  return {
    revenue30: revenue30._sum.totalCents ?? 0,
    revenuePrevious30: revenuePrevious30._sum.totalCents ?? 0,
    revenueToday: revenueToday._sum.totalCents ?? 0,
    orders30,
    ordersPrevious30,
    ordersToday,
    customers30,
    customersPrevious30,
    pendingOrders,
    refundRequests,
    lowStock,
    outOfStock,
  };
}

export function percentChange(current: number, previous: number): number | null {
  // Growth from zero is not "infinity per cent", it is "there was nothing to
  // compare against" — and rendering ∞ on a dashboard helps nobody.
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Daily revenue and order count for a sparkline.
 *
 * One grouped query, then filled in JavaScript. Days with no orders must appear
 * as zero rather than be missing — a chart that silently skips quiet days
 * compresses time and makes a slump look like a plateau.
 */
export async function getSalesTrend(days = 30) {
  const since = daysAgo(days - 1);

  const rows = await prisma.$queryRaw<{ day: Date; revenue: bigint; orders: bigint }[]>`
    SELECT date_trunc('day', "placedAt") AS day,
           COALESCE(SUM("totalCents"), 0)::bigint AS revenue,
           COUNT(*)::bigint AS orders
    FROM "orders"
    WHERE "placedAt" >= ${since}
      AND "status" = ANY(${EARNING_STATUSES}::"OrderStatus"[])
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map(rows.map((row) => [startOfDay(row.day).getTime(), row]));

  return Array.from({ length: days }, (_, index) => {
    const date = daysAgo(days - 1 - index);
    const row = byDay.get(date.getTime());
    return {
      date,
      revenueCents: Number(row?.revenue ?? 0),
      orders: Number(row?.orders ?? 0),
    };
  });
}

/**
 * Best sellers over the window.
 *
 * Aggregated in SQL rather than by grouping in Prisma, because an order item
 * records a *variant*, not a product — "Meridian, medium" and "Meridian,
 * large" are one product on this card. Grouping by variant and re-summing in
 * JavaScript would mean pulling every line item of the month into memory to
 * add up numbers Postgres can add up in place.
 */
export async function getTopProducts(limit = 5) {
  const since = daysAgo(30);

  const rows = await prisma.$queryRaw<
    { id: string; name: string; slug: string; units: bigint; revenue: bigint }[]
  >`
    SELECT p."id", p."name", p."slug",
           COALESCE(SUM(oi."quantity"), 0)::bigint AS units,
           COALESCE(SUM(oi."totalCents"), 0)::bigint AS revenue
    FROM "order_items" oi
    JOIN "orders" o ON o."id" = oi."orderId"
    JOIN "variants" v ON v."id" = oi."variantId"
    JOIN "products" p ON p."id" = v."productId"
    WHERE o."placedAt" >= ${since}
      AND o."status" = ANY(${EARNING_STATUSES}::"OrderStatus"[])
    GROUP BY p."id", p."name", p."slug"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    units: Number(row.units),
    revenueCents: Number(row.revenue),
  }));
}

/** Revenue by category, for the "where is the money coming from" card. */
export async function getTopCategories(limit = 5) {
  const since = daysAgo(30);

  const rows = await prisma.$queryRaw<{ name: string; revenue: bigint; units: bigint }[]>`
    SELECT c."name" AS name,
           COALESCE(SUM(oi."totalCents"), 0)::bigint AS revenue,
           COALESCE(SUM(oi."quantity"), 0)::bigint AS units
    FROM "order_items" oi
    JOIN "orders" o ON o."id" = oi."orderId"
    JOIN "variants" v ON v."id" = oi."variantId"
    JOIN "product_categories" pc ON pc."productId" = v."productId"
    JOIN "categories" c ON c."id" = pc."categoryId"
    WHERE o."placedAt" >= ${since}
      AND o."status" = ANY(${EARNING_STATUSES}::"OrderStatus"[])
    GROUP BY c."name"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    name: row.name,
    revenueCents: Number(row.revenue),
    units: Number(row.units),
  }));
}

/** The most recent orders, for the "what is happening right now" panel. */
export async function getRecentOrders(limit = 6) {
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      email: true,
      status: true,
      totalCents: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
}

/**
 * System health, from things that are actually observable here.
 *
 * Deliberately not a green tick that always shows green. Each row answers a
 * question someone would otherwise have to open a console to answer, and an
 * unconfigured integration reports as unconfigured rather than as healthy.
 */
export async function getSystemHealth() {
  const started = Date.now();

  const [productCount, stuckPending, failedPayments, unreadCritical] = await Promise.all([
    prisma.product.count(),
    // Pending for over an hour means a checkout that never completed and whose
    // stock reservation may still be held.
    prisma.order.count({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 3_600_000) } },
    }),
    prisma.payment.count({
      where: { status: 'FAILED', createdAt: { gte: daysAgo(7) } },
    }),
    prisma.adminAlert.count({ where: { level: 'CRITICAL', readAt: null } }),
  ]);

  return {
    databaseLatencyMs: Date.now() - started,
    productCount,
    stuckPending,
    failedPayments,
    unreadCritical,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    taxProviderConfigured: Boolean(process.env.TAXJAR_API_KEY),
    mediaConfigured: Boolean(process.env.CLOUDINARY_API_KEY),
  };
}
