import 'server-only';

import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

/**
 * Reporting.
 *
 * Every figure is computed from live tables. The brief allowed placeholder
 * analytics; a report that invents numbers is worse than no report, because
 * someone eventually makes a buying decision on one. Where a metric genuinely
 * cannot be produced yet — traffic, which needs an analytics pipeline this
 * phase does not own — the report says so instead of drawing a plausible line.
 */

const EARNING: OrderStatus[] = ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

export type ReportKey = 'sales' | 'products' | 'customers' | 'coupons' | 'inventory' | 'returns';

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Cents, rendered as money on screen and as a plain decimal in exports. */
  money?: boolean;
}

export interface Report {
  key: ReportKey;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
}

function since(days: number): Date {
  const date = new Date(Date.now() - days * 86_400_000);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function buildReport(key: ReportKey, days = 30): Promise<Report> {
  const from = since(days);

  switch (key) {
    case 'sales': {
      const rows = await prisma.$queryRaw<
        {
          day: Date;
          orders: bigint;
          gross: bigint;
          discount: bigint;
          tax: bigint;
          shipping: bigint;
        }[]
      >`
        SELECT date_trunc('day', "placedAt") AS day,
               COUNT(*)::bigint AS orders,
               COALESCE(SUM("totalCents"), 0)::bigint AS gross,
               COALESCE(SUM("discountCents"), 0)::bigint AS discount,
               COALESCE(SUM("taxCents"), 0)::bigint AS tax,
               COALESCE(SUM("shippingCents"), 0)::bigint AS shipping
        FROM "orders"
        WHERE "placedAt" >= ${from} AND "status" = ANY(${EARNING}::"OrderStatus"[])
        GROUP BY 1 ORDER BY 1 DESC
      `;

      return {
        key,
        title: 'Sales',
        description: `Daily totals for the last ${days} days.`,
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'orders', label: 'Orders', align: 'right' },
          { key: 'gross', label: 'Gross', align: 'right', money: true },
          { key: 'discount', label: 'Discounts', align: 'right', money: true },
          { key: 'tax', label: 'Tax', align: 'right', money: true },
          { key: 'shipping', label: 'Shipping', align: 'right', money: true },
        ],
        rows: rows.map((row) => ({
          day: row.day.toISOString().slice(0, 10),
          orders: Number(row.orders),
          gross: Number(row.gross),
          discount: Number(row.discount),
          tax: Number(row.tax),
          shipping: Number(row.shipping),
        })),
      };
    }

    case 'products': {
      const rows = await prisma.$queryRaw<
        { name: string; sku: string; units: bigint; revenue: bigint }[]
      >`
        SELECT p."name", COALESCE(p."sku", '—') AS sku,
               COALESCE(SUM(oi."quantity"), 0)::bigint AS units,
               COALESCE(SUM(oi."totalCents"), 0)::bigint AS revenue
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
        JOIN "variants" v ON v."id" = oi."variantId"
        JOIN "products" p ON p."id" = v."productId"
        WHERE o."placedAt" >= ${from} AND o."status" = ANY(${EARNING}::"OrderStatus"[])
        GROUP BY p."id", p."name", p."sku"
        ORDER BY revenue DESC LIMIT 100
      `;

      return {
        key,
        title: 'Products',
        description: `Units and revenue per product, last ${days} days.`,
        columns: [
          { key: 'name', label: 'Product' },
          { key: 'sku', label: 'SKU' },
          { key: 'units', label: 'Units', align: 'right' },
          { key: 'revenue', label: 'Revenue', align: 'right', money: true },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          sku: row.sku,
          units: Number(row.units),
          revenue: Number(row.revenue),
        })),
      };
    }

    case 'customers': {
      const rows = await prisma.$queryRaw<
        { email: string; name: string; orders: bigint; spend: bigint; first: Date }[]
      >`
        SELECT u."email",
               COALESCE(NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), ''), '—') AS name,
               COUNT(o."id")::bigint AS orders,
               COALESCE(SUM(o."totalCents"), 0)::bigint AS spend,
               MIN(o."placedAt") AS first
        FROM "users" u
        JOIN "orders" o ON o."userId" = u."id"
        WHERE o."status" = ANY(${EARNING}::"OrderStatus"[])
        GROUP BY u."id", u."email", u."firstName", u."lastName"
        ORDER BY spend DESC LIMIT 100
      `;

      return {
        key,
        title: 'Customers',
        description: 'Lifetime spend, highest first. All time, not windowed.',
        columns: [
          { key: 'name', label: 'Customer' },
          { key: 'email', label: 'Email' },
          { key: 'orders', label: 'Orders', align: 'right' },
          { key: 'spend', label: 'Lifetime value', align: 'right', money: true },
          { key: 'first', label: 'First order' },
        ],
        rows: rows.map((row) => ({
          name: row.name,
          email: row.email,
          orders: Number(row.orders),
          spend: Number(row.spend),
          first: row.first ? row.first.toISOString().slice(0, 10) : '—',
        })),
      };
    }

    case 'coupons': {
      const coupons = await prisma.coupon.findMany({
        select: {
          code: true,
          type: true,
          value: true,
          isActive: true,
          _count: { select: { redemptions: true } },
          redemptions: { select: { discountCents: true } },
        },
        take: 100,
      });

      return {
        key,
        title: 'Coupons',
        description: 'Redemptions and the discount actually given away.',
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'type', label: 'Type' },
          { key: 'uses', label: 'Uses', align: 'right' },
          { key: 'given', label: 'Discount given', align: 'right', money: true },
        ],
        rows: coupons
          .map((coupon) => ({
            code: coupon.code,
            type: coupon.type,
            uses: coupon._count.redemptions,
            given: coupon.redemptions.reduce((sum, row) => sum + row.discountCents, 0),
          }))
          .sort((a, b) => b.given - a.given),
      };
    }

    case 'inventory': {
      const rows = await prisma.inventory.findMany({
        orderBy: { quantity: 'asc' },
        take: 200,
        include: {
          variant: {
            select: {
              sku: true,
              name: true,
              priceCents: true,
              product: { select: { name: true } },
            },
          },
        },
      });

      return {
        key,
        title: 'Inventory',
        description: 'Current stock, scarcest first, with the capital tied up in it.',
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'sku', label: 'SKU' },
          { key: 'onHand', label: 'On hand', align: 'right' },
          { key: 'reserved', label: 'Reserved', align: 'right' },
          { key: 'available', label: 'Available', align: 'right' },
          { key: 'value', label: 'Stock value', align: 'right', money: true },
        ],
        rows: rows.map((row) => ({
          product: `${row.variant.product.name} — ${row.variant.name}`,
          sku: row.variant.sku,
          onHand: row.quantity,
          reserved: row.reserved,
          available: row.quantity - row.reserved,
          value: row.quantity * row.variant.priceCents,
        })),
      };
    }

    case 'returns': {
      const rows = await prisma.returnRequest.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          order: { select: { orderNumber: true, totalCents: true } },
          items: { select: { quantity: true, reason: true } },
        },
      });

      return {
        key,
        title: 'Returns',
        description: `Return requests raised in the last ${days} days.`,
        columns: [
          { key: 'returnNumber', label: 'Return' },
          { key: 'orderNumber', label: 'Order' },
          { key: 'status', label: 'Status' },
          { key: 'items', label: 'Items', align: 'right' },
          { key: 'reason', label: 'Main reason' },
          { key: 'raised', label: 'Raised' },
        ],
        rows: rows.map((row) => ({
          returnNumber: row.returnNumber,
          orderNumber: row.order.orderNumber,
          status: row.status,
          items: row.items.reduce((sum, item) => sum + item.quantity, 0),
          reason: row.items[0]?.reason ?? '—',
          raised: row.createdAt.toISOString().slice(0, 10),
        })),
      };
    }
  }
}

export const REPORTS: { key: ReportKey; label: string }[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'products', label: 'Products' },
  { key: 'customers', label: 'Customers' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'returns', label: 'Returns' },
];

/**
 * CSV, quoted correctly.
 *
 * Hand-rolled rather than pulled from a library: the whole specification is
 * "double the quotes and wrap anything containing a comma, quote or newline",
 * which is the four lines below. Money is emitted as a decimal, because a
 * spreadsheet showing 3900 where the merchant expected 39.00 is a support
 * ticket that arrives every single time.
 */
export function toCsv(report: Report): string {
  const escape = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = report.columns.map((column) => escape(column.label)).join(',');

  const body = report.rows.map((row) =>
    report.columns
      .map((column) => {
        const value = row[column.key] ?? '';
        return escape(column.money ? (Number(value) / 100).toFixed(2) : value);
      })
      .join(','),
  );

  return [header, ...body].join('\r\n');
}
