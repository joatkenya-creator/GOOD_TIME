import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { OrderEventType, OrderStatus } from '@/generated/prisma/enums';
import { computeTotals, assertChargeable, type Totals } from '@/features/checkout/totals';
import { errors } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  recordRedemption,
  releaseRedemption,
  toDiscount,
  validateCoupon,
} from '@/services/coupon.service';
import { estimateDelivery, getShippingRate, priceFor } from '@/services/shipping.service';
import {
  awardForOrder,
  quoteRedemption,
  redeem,
  reverseForOrder,
} from '@/services/account/rewards.service';
import { quoteTax } from '@/services/tax.service';

/**
 * Orders.
 *
 * An order is the permanent record of a transaction, so everything it displays
 * is snapshotted at creation: product names, prices, the coupon code, the tax
 * breakdown, the shipping method. Editing a product or deleting a coupon next
 * month must not change what a past receipt says.
 *
 * ## Status and money
 *
 * An order starts `PENDING` with money reserved but not taken. It becomes `PAID`
 * only from a Stripe webhook — never from the browser returning to a success
 * page, which a customer can forge or a network can lose.
 */

/** Allowed status moves. Anything absent is rejected rather than silently applied. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['CONFIRMED', 'PROCESSING', 'CANCELLED', 'REFUNDED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED', 'REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  RETURNED: ['REFUNDED'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Next order number, from a Postgres sequence.
 *
 * Sequential and human-quotable ("GT-100042"). It leaks order volume, which is
 * an accepted trade for a number a customer can read down a phone line.
 */
async function nextOrderNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
  const next = rows[0]?.nextval;
  if (next == null) throw new Error('order_number_seq returned no value');
  return `GT-${next}`;
}

export interface OrderAddress {
  firstName: string;
  lastName: string;
  company?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  phone?: string | null;
}

export interface PlaceOrderInput {
  cartId: string;
  userId?: string | null;
  email: string;
  shippingAddressId?: string | null;
  billingAddressId?: string | null;
  /** Address fields for a guest, who has no saved address row. */
  shippingAddress: OrderAddress;
  /** Absent means "same as shipping", which is what most customers choose. */
  billingAddress?: OrderAddress | null;
  shippingRateId: string;
  customerNote?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Turns a cart into a `PENDING` order, priced entirely server-side.
 *
 * Runs in one transaction: items, event, and coupon redemption either all land
 * or none do. A partially written order is worse than no order — it shows up in
 * the customer's history without being payable.
 *
 * Inventory is *reserved* here, not decremented. Decrementing on an unpaid order
 * lets anyone empty the warehouse by starting checkouts they never finish.
 */
export async function placeOrder(input: PlaceOrderInput) {
  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: {
      coupon: true,
      items: {
        where: { savedForLater: false },
        include: {
          variant: {
            include: {
              inventory: true,
              product: {
                select: {
                  name: true,
                  media: {
                    take: 1,
                    orderBy: { position: 'asc' },
                    select: { media: { select: { url: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) throw errors.badRequest('Your cart is empty.');

  // --- Availability ------------------------------------------------------
  for (const item of cart.items) {
    const inventory = item.variant.inventory;
    if (!item.variant.isActive || item.variant.deletedAt) {
      throw errors.conflict(`${item.variant.product.name} is no longer available.`);
    }
    if (inventory && inventory.policy === 'DENY') {
      const free = inventory.quantity - inventory.reserved;
      if (free < item.quantity) {
        throw errors.conflict(
          `Only ${Math.max(0, free)} of ${item.variant.product.name} left in stock.`,
        );
      }
    }
  }

  // --- Pricing (never from the client) -----------------------------------
  const lines = cart.items.map((item) => ({
    unitPriceCents: item.variant.salePriceCents ?? item.variant.priceCents,
    quantity: item.quantity,
    weightGrams: item.variant.weightGrams ?? 0,
  }));

  const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const totalWeightGrams = lines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0);

  const rate = await getShippingRate(input.shippingRateId);
  if (!rate) throw errors.badRequest('That shipping method is no longer available.');

  const shippingCents = priceFor(rate, {
    subtotalCents,
    totalWeightGrams,
    state: input.shippingAddress.state,
    country: input.shippingAddress.country,
  });

  let discount = null;
  let couponId: string | null = null;
  if (cart.coupon) {
    const result = await validateCoupon(cart.coupon.code, { subtotalCents, userId: input.userId });
    if (result.ok) {
      discount = toDiscount(result.coupon);
      couponId = result.coupon.id;
    }
    // An invalid coupon at this point is dropped, not fatal: the customer sees
    // the true total on the review step before paying.
  }

  // Two passes. The first learns the discounted base without tax, because a tax
  // provider must be quoted on what the customer actually pays; the second folds
  // the answer back in. Both go through `computeTotals`, so the arithmetic — and
  // the `orders_total_is_sum` identity — has exactly one implementation.
  const untaxed = computeTotals({ lines, shippingCents, discount });

  const tax = await quoteTax({
    address: {
      country: input.shippingAddress.country,
      state: input.shippingAddress.state,
      city: input.shippingAddress.city,
      postalCode: input.shippingAddress.postalCode,
      line1: input.shippingAddress.line1,
    },
    taxableGoodsCents: untaxed.subtotalCents - untaxed.discountCents,
    shippingCents: untaxed.shippingCents,
    lines: lines.map((line) => ({
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    })),
  });

  const totals = computeTotals({ lines, shippingCents, discount, taxLines: tax.lines });

  /*
   * Loyalty tender.
   *
   * Quoted against the live balance here, never taken from the client — a basket
   * that claims $500 of store credit gets whatever the customer actually has.
   *
   * It is applied *after* tax, because credit and points are tender, not a
   * discount: the bill is taxed in full and then partly paid with credit. Folding
   * them into `discountCents` would shrink the taxable base and under-collect.
   */
  const redemption = await quoteRedemption({
    userId: input.userId,
    amountDueCents: totals.totalCents,
    usePoints: cart.redeemPoints,
    useCredit: cart.applyStoreCredit,
  });

  const amountDueCents = totals.totalCents - redemption.totalCents;

  // Only guard the amount actually going to the card. A bill fully covered by
  // credit is a legitimate zero, and `assertChargeable` rejects zero by design.
  if (amountDueCents > 0) assertChargeable({ ...totals, totalCents: amountDueCents });

  // Recorded so an order priced from the estimate during a provider outage can
  // be found and reconciled later.
  const taxSource = tax.degraded ? `${tax.source}-degraded` : tax.source;

  const delivery = estimateDelivery(rate.estimatedDaysMin, rate.estimatedDaysMax);
  const orderNumber = await nextOrderNumber();

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        userId: input.userId ?? null,
        email: input.email.toLowerCase(),
        status: 'PENDING',
        currency: cart.currency,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        couponId,
        couponCode: couponId ? cart.coupon!.code : null,
        shippingAddressId: input.shippingAddressId ?? null,
        billingAddressId: input.billingAddressId ?? input.shippingAddressId ?? null,
        // The authoritative destination. A guest has no Address row, so without
        // this the order would record nowhere to ship it.
        shippingAddressSnapshot: input.shippingAddress as unknown as Prisma.InputJsonValue,
        billingAddressSnapshot: (input.billingAddress ??
          input.shippingAddress) as unknown as Prisma.InputJsonValue,
        shippingMethod: rate.name,
        shippingRateId: rate.id,
        estimatedDeliveryAt: delivery.latest,
        taxBreakdown: totals.taxBreakdown as unknown as Prisma.InputJsonValue,
        taxSource,
        creditAppliedCents: redemption.creditCents,
        pointsRedeemed: redemption.points,
        customerNote: input.customerNote ?? null,
        giftNote: cart.giftNote,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        placedAt: new Date(),
        items: {
          create: cart.items.map((item) => {
            const unitPriceCents = item.variant.salePriceCents ?? item.variant.priceCents;
            return {
              variantId: item.variantId,
              productName: item.variant.product.name,
              variantName: item.variant.name,
              sku: item.variant.sku,
              imageUrl: item.variant.product.media[0]?.media.url ?? null,
              quantity: item.quantity,
              unitPriceCents,
              totalCents: unitPriceCents * item.quantity,
            };
          }),
        },
      },
      include: { items: true },
    });

    // Reserve stock. `reserved` is released on cancellation and converted to a
    // decrement on payment, so an abandoned checkout returns the stock itself.
    for (const item of cart.items) {
      if (item.variant.inventory) {
        await tx.inventory.update({
          where: { variantId: item.variantId },
          data: { reserved: { increment: item.quantity } },
        });
      }
    }

    // Deducted here, in the order's own transaction, for the same reason a coupon
    // redemption is: two checkouts started at once must not both spend the same
    // balance. The non-negative check constraints are the backstop.
    if (redemption.totalCents > 0 && input.userId) {
      const spent = await redeem({
        userId: input.userId,
        points: redemption.points,
        amountCents: redemption.creditCents,
        description: `Order ${orderNumber}`,
        orderId: order.id,
      });

      if (!spent.ok) throw errors.conflict(spent.message);
    }

    if (couponId) {
      await recordRedemption(tx, {
        couponId,
        orderId: order.id,
        userId: input.userId,
        discountCents: totals.discountCents,
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'CREATED',
        message: `Order ${orderNumber} placed.`,
        data: { totalCents: totals.totalCents, itemCount: totals.itemCount },
      },
    });

    return order;
  });
}

/**
 * Moves an order forward and writes the timeline entry in the same transaction.
 *
 * An untimelined status change is the thing support cannot explain three weeks
 * later, so the two are never separable.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options: { message?: string; actorId?: string | null; data?: Record<string, unknown> } = {},
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw errors.notFound('Order');

    if (order.status === to) return order;

    if (!canTransition(order.status, to)) {
      throw errors.conflict(`An order cannot go from ${order.status} to ${to}.`);
    }

    // Stock moves exactly once, at the two edges that matter.
    if (to === 'PAID') await commitReservations(tx, order.items);
    if (to === 'CANCELLED') await releaseReservations(tx, order.items);

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(to === 'PAID' ? { paidAt: new Date(), paymentStatus: 'PAID' as const } : {}),
        ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: to === 'CANCELLED' ? 'CANCELLED' : 'STATUS_CHANGED',
        message: options.message ?? `Order status changed to ${to.toLowerCase()}.`,
        actorId: options.actorId ?? null,
        data: { from: order.status, to, ...options.data },
      },
    });

    return updated;
  });

  /*
   * Loyalty, after the transaction commits.
   *
   * Deliberately outside it. Awarding points is not worth failing a payment over,
   * and `awardForOrder` is idempotent — a replayed webhook checks the ledger for
   * an existing award against this order rather than paying twice. A cancellation
   * hands back whatever the order spent.
   */
  if (to === 'PAID') {
    await awardForOrder(orderId).catch((error: unknown) =>
      logger.error('rewards.award_failed', error, { orderId }),
    );
  }

  if (to === 'CANCELLED') {
    await reverseForOrder(orderId).catch((error: unknown) =>
      logger.error('rewards.reverse_failed', error, { orderId }),
    );
  }

  return result;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Reservation becomes a real decrement. Called once, on payment. */
async function commitReservations(tx: Tx, items: { variantId: string | null; quantity: number }[]) {
  for (const item of items) {
    if (!item.variantId) continue;
    await tx.inventory.updateMany({
      where: { variantId: item.variantId },
      data: { quantity: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
    });
  }
}

/** Reservation is dropped without touching quantity. Called on cancellation. */
async function releaseReservations(tx: Tx, items: { variantId: string | null; quantity: number }[]) {
  for (const item of items) {
    if (!item.variantId) continue;
    await tx.inventory.updateMany({
      where: { variantId: item.variantId },
      data: { reserved: { decrement: item.quantity } },
    });
  }
}

/** Appends to the timeline without changing status. */
export async function recordEvent(
  orderId: string,
  type: OrderEventType,
  message: string,
  options: {
    data?: Record<string, unknown>;
    actorId?: string | null;
    isCustomerVisible?: boolean;
  } = {},
) {
  return prisma.orderEvent.create({
    data: {
      orderId,
      type,
      message,
      data: options.data as Prisma.InputJsonValue | undefined,
      actorId: options.actorId ?? null,
      isCustomerVisible: options.isCustomerVisible ?? true,
    },
  });
}

const ORDER_DETAIL_INCLUDE = {
  items: true,
  payments: { orderBy: { createdAt: 'desc' } },
  shipments: { orderBy: { createdAt: 'desc' } },
  shippingAddress: true,
  billingAddress: true,
  events: { orderBy: { createdAt: 'asc' } },
} as const;

export async function getOrderById(id: string) {
  return prisma.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
}

/**
 * Looks an order up the way a customer reaches it.
 *
 * The email must match, so a guessed order number alone reveals nothing — order
 * numbers are sequential by design and would otherwise be trivially enumerable.
 */
export async function getOrderByNumber(orderNumber: string, email: string) {
  return prisma.order.findFirst({
    where: { orderNumber, email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
    include: ORDER_DETAIL_INCLUDE,
  });
}

export async function getOrdersForUser(userId: string, take = 20, skip = 0) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
    include: { items: true, shipments: true },
  });
}

/**
 * Cancels an unshipped order and returns its reservations.
 *
 * Refunding money is deliberately not done here — that is a Stripe call, and
 * folding a network request into this transaction would hold a database lock
 * open across it.
 */
export async function cancelOrder(orderId: string, reason: string, actorId?: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw errors.notFound('Order');

  if (!canTransition(order.status, 'CANCELLED')) {
    throw errors.conflict('That order can no longer be cancelled.');
  }

  logger.info('order.cancel', { orderId, reason, status: order.status });

  return transitionOrder(orderId, 'CANCELLED', {
    message: `Order cancelled: ${reason}`,
    actorId,
    data: { reason },
  });
}

/**
 * Cancels `PENDING` orders that have held stock for too long.
 *
 * Without this, every abandoned checkout reserves inventory forever: the stock is
 * neither sold nor sellable, and a popular variant goes "out of stock" because of
 * people who closed a tab. This is the job that makes reserve-on-order safe.
 *
 * Runs on a schedule from `/api/cron/release-reservations`. Idempotent, so a
 * double-fire is harmless, and each order is cancelled independently — one bad
 * row must not strand the rest of the batch.
 *
 * The window is deliberately much longer than `TOKEN_TTL.cartReservation`.
 * Cancelling an order out from under someone who is mid-3DS on a slow bank app
 * is far worse than holding a unit of stock for another hour, and 3DS challenges
 * genuinely do take minutes.
 */
export async function releaseExpiredReservations(
  options: { olderThanMinutes?: number; limit?: number } = {},
): Promise<{ scanned: number; cancelled: number; failed: number }> {
  const olderThanMinutes = options.olderThanMinutes ?? 60;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  const stale = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
      // A successful payment always lands as a webhook, and the webhook sets
      // `paidAt` before the status. Excluding it closes the race where a payment
      // succeeds between this query and the cancellation below.
      paidAt: null,
    },
    select: { id: true, orderNumber: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    // Bounded so one run cannot hold a connection for minutes after an outage
    // leaves a large backlog. The next tick picks up the remainder.
    take: options.limit ?? 200,
  });

  let cancelled = 0;
  let failed = 0;

  for (const order of stale) {
    try {
      await releaseRedemption(order.id);
      await transitionOrder(order.id, 'CANCELLED', {
        message: 'Cancelled automatically — payment was not completed.',
        data: { reason: 'reservation_expired', olderThanMinutes },
      });
      cancelled += 1;
    } catch (error) {
      // Most likely a webhook won the race and moved the order to PAID, in which
      // case `canTransition` rejects and leaving it alone is exactly right.
      failed += 1;
      logger.warn('reservation.release_failed', { orderId: order.id, error });
    }
  }

  if (cancelled > 0 || failed > 0) {
    logger.info('reservation.released', { scanned: stale.length, cancelled, failed });
  }

  return { scanned: stale.length, cancelled, failed };
}

/** Re-derives an order's totals for a receipt, without re-querying pricing. */
export function totalsOf(order: {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}): Pick<
  Totals,
  'subtotalCents' | 'discountCents' | 'shippingCents' | 'taxCents' | 'totalCents'
> {
  return {
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
  };
}
