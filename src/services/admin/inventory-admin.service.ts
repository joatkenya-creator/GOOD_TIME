import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { StockAdjustmentReason } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * Inventory administration.
 *
 * The rule this module exists to enforce: **no stock number changes without a
 * row saying who changed it and why.** A stock adjustment is the easiest place
 * in an ecommerce system to hide theft, and an inline "just edit the number"
 * field anywhere else in the admin would quietly bypass this.
 *
 * `Inventory.quantity` is therefore only ever written inside `adjustStock`, in
 * the same transaction as the ledger row.
 */

export interface InventoryQuery {
  q?: string;
  /** `low`, `out`, `ok`, or empty for everything. */
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listInventory(query: InventoryQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 10), 100);

  const where: Prisma.InventoryWhereInput = {
    ...(query.q
      ? {
          variant: {
            OR: [
              { sku: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
              { product: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
    ...(query.status === 'out' ? { quantity: { lte: 0 } } : {}),
    ...(query.status === 'low' ? { quantity: { gt: 0, lte: 5 } } : {}),
    ...(query.status === 'ok' ? { quantity: { gt: 5 } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      // Scarcest first: this screen exists to find what is about to run out,
      // and alphabetical order buries that under whatever starts with "A".
      orderBy: { quantity: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            name: true,
            priceCents: true,
            product: { select: { id: true, name: true, status: true } },
          },
        },
      },
    }),
    prisma.inventory.count({ where }),
  ]);

  return {
    items: items.map((row) => ({ ...row, available: row.quantity - row.reserved })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type InventoryRow = Awaited<ReturnType<typeof listInventory>>['items'][number];

export async function getInventoryCounts() {
  const [out, low, ok] = await Promise.all([
    prisma.inventory.count({ where: { quantity: { lte: 0 } } }),
    prisma.inventory.count({ where: { quantity: { gt: 0, lte: 5 } } }),
    prisma.inventory.count({ where: { quantity: { gt: 5 } } }),
  ]);
  return { out, low, ok, total: out + low + ok };
}

/**
 * The only way a stock number changes.
 *
 * Ledger row and count move in one transaction, so a crash between them cannot
 * leave a quantity nobody can explain. `quantityAfter` is written rather than
 * derived — replaying deltas to answer "what did we think we had on the 3rd?"
 * is both slow and wrong the moment a row is deleted.
 */
export async function adjustStock(input: {
  variantId: string;
  delta: number;
  reason: StockAdjustmentReason;
  note?: string | null;
  actorId: string;
  orderId?: string | null;
}): Promise<{ quantityAfter: number }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw errors.badRequest('An adjustment needs a whole number that is not zero.');
  }

  return prisma.$transaction(async (tx) => {
    const inventory = await tx.inventory.findUnique({
      where: { variantId: input.variantId },
      select: { id: true, quantity: true, reserved: true, location: true },
    });
    if (!inventory) throw errors.notFound('Inventory record');

    const quantityAfter = inventory.quantity + input.delta;

    // Physical stock cannot be negative. Overselling is expressed by
    // `reserved` exceeding `quantity`, which is a different fact.
    if (quantityAfter < 0) {
      throw errors.badRequest(
        `That would leave ${quantityAfter}. There are ${inventory.quantity} on hand.`,
      );
    }

    await tx.inventory.update({
      where: { variantId: input.variantId },
      data: { quantity: quantityAfter },
    });

    await tx.stockAdjustment.create({
      data: {
        variantId: input.variantId,
        delta: input.delta,
        quantityAfter,
        reason: input.reason,
        note: input.note ?? null,
        actorId: input.actorId,
        orderId: input.orderId ?? null,
        location: inventory.location,
      },
    });

    return { quantityAfter };
  });
}

/** The history behind one variant's current number. */
export async function listStockHistory(variantId: string, limit = 50) {
  return prisma.stockAdjustment.findMany({
    where: { variantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, lastName: true, email: true } },
      order: { select: { orderNumber: true } },
    },
  });
}

/** Recent adjustments across everything, for the module's activity panel. */
export async function listRecentAdjustments(limit = 20) {
  return prisma.stockAdjustment.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, email: true } },
      variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
    },
  });
}

export async function setLowStockThreshold(variantId: string, threshold: number): Promise<void> {
  await prisma.inventory.update({
    where: { variantId },
    data: { lowStockThreshold: Math.max(0, Math.floor(threshold)) },
  });
}

export const ADJUSTMENT_REASONS: { value: StockAdjustmentReason; label: string }[] = [
  { value: 'RECEIVED', label: 'Stock received' },
  { value: 'RETURNED', label: 'Customer return' },
  { value: 'RECOUNT', label: 'Physical recount' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'LOST', label: 'Lost or stolen' },
  { value: 'CORRECTION', label: 'Correcting a mistake' },
  { value: 'TRANSFER', label: 'Transferred' },
];
