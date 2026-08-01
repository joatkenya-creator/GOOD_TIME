import 'server-only';

import type { ReturnReason, ReturnStatus } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export { RETURN_STATUS_COPY } from '@/features/account/returns';

/**
 * Returns.
 *
 * A return is its own aggregate, not a flag on an order: it has its own
 * lifecycle, its own timeline and its own subset of line items. An order can be
 * partly returned twice, for different reasons, weeks apart, and a boolean cannot
 * express that.
 *
 * ## What is architecture and what is live
 *
 * Customers can **request** a return, and the request is stored, numbered and
 * visible to them. Everything after that — approval, inspection, refund — has its
 * statuses and transitions defined here but no interface driving them; that
 * arrives with the admin dashboard. `refundOrder` in the payment service is what
 * an approval will eventually call, and it already works.
 */

/** How long after delivery a return may be requested. */
export const RETURN_WINDOW_DAYS = 30;

/** Allowed status moves. Anything absent is rejected rather than silently applied. */
const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'],
  REJECTED: [],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: ['REFUNDED', 'REJECTED'],
  REFUNDED: [],
  CANCELLED: [],
};

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return TRANSITIONS[from].includes(to);
}


/**
 * Next RMA number, from a Postgres sequence.
 *
 * Same reasoning as order numbers, and offset into the same range so the two are
 * never confused: an RMA is prefixed, an order is not.
 */
async function nextReturnNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('return_number_seq')`;
  const next = rows[0]?.nextval;
  if (next == null) throw new Error('return_number_seq returned no value');
  return `RMA-${next}`;
}

/**
 * Whether an order can still be returned, and why not if it cannot.
 *
 * Returned as a reason rather than a boolean so the UI can say what is wrong
 * instead of hiding a button and leaving the customer to guess.
 */
export function returnEligibility(order: {
  status: string;
  placedAt: Date | null;
  createdAt: Date;
}): { eligible: boolean; reason: string | null; deadline: Date | null } {
  const RETURNABLE = ['DELIVERED', 'SHIPPED'];

  if (!RETURNABLE.includes(order.status)) {
    return {
      eligible: false,
      reason:
        order.status === 'REFUNDED' || order.status === 'RETURNED'
          ? 'This order has already been returned.'
          : 'This order has not shipped yet, so there is nothing to send back.',
      deadline: null,
    };
  }

  const from = order.placedAt ?? order.createdAt;
  const deadline = new Date(from.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (Date.now() > deadline.getTime()) {
    return {
      eligible: false,
      reason: `The ${RETURN_WINDOW_DAYS}-day return window closed on ${deadline.toLocaleDateString('en-US')}.`,
      deadline,
    };
  }

  return { eligible: true, reason: null, deadline };
}

export interface CreateReturnInput {
  orderId: string;
  userId?: string | null;
  reason: ReturnReason;
  comment?: string | null;
  items: { orderItemId: string; quantity: number }[];
}

/**
 * Files a return request.
 *
 * Validates that every line belongs to the order and that the customer is not
 * returning more than they bought — including across earlier returns, which is
 * the check that a naive implementation misses and a determined customer finds.
 */
export async function createReturn(input: CreateReturnInput) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, ...(input.userId ? { userId: input.userId } : {}) },
    include: { items: true },
  });

  if (!order) throw errors.notFound('Order');

  const eligibility = returnEligibility(order);
  if (!eligibility.eligible) throw errors.conflict(eligibility.reason ?? 'This order cannot be returned.');

  const byId = new Map(order.items.map((item) => [item.id, item]));

  // Quantities already claimed on other open or completed returns.
  const claimed = await prisma.returnItem.groupBy({
    by: ['orderItemId'],
    where: {
      orderItemId: { in: input.items.map((item) => item.orderItemId) },
      returnRequest: { status: { notIn: ['CANCELLED', 'REJECTED'] } },
    },
    _sum: { quantity: true },
  });

  const claimedById = new Map(claimed.map((row) => [row.orderItemId, row._sum.quantity ?? 0]));

  for (const line of input.items) {
    const orderItem = byId.get(line.orderItemId);
    if (!orderItem) throw errors.badRequest('That item is not on this order.');

    const remaining = orderItem.quantity - (claimedById.get(line.orderItemId) ?? 0);
    if (line.quantity > remaining) {
      throw errors.conflict(
        remaining <= 0
          ? `${orderItem.productName} has already been returned.`
          : `You can return at most ${remaining} of ${orderItem.productName}.`,
      );
    }
  }

  const returnNumber = await nextReturnNumber();

  const request = await prisma.returnRequest.create({
    data: {
      returnNumber,
      orderId: order.id,
      userId: order.userId,
      reason: input.reason,
      comment: input.comment?.trim() || null,
      items: {
        create: input.items.map((line) => ({
          orderItemId: line.orderItemId,
          quantity: line.quantity,
          reason: input.reason,
        })),
      },
    },
    include: { items: true },
  });

  // The order's own timeline carries it too, so "where is my order" and "where is
  // my return" do not need to be asked separately.
  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'NOTE_ADDED',
      message: `Return ${returnNumber} requested.`,
      data: { returnNumber, reason: input.reason },
    },
  });

  logger.info('return.created', { returnNumber, orderId: order.id });
  return request;
}

const RETURN_INCLUDE = {
  items: { include: { orderItem: true } },
  order: { select: { orderNumber: true, email: true, placedAt: true, createdAt: true } },
} as const;

export async function listReturns(userId: string) {
  return prisma.returnRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: RETURN_INCLUDE,
  });
}

export async function getReturn(userId: string, returnNumber: string) {
  return prisma.returnRequest.findFirst({
    where: { returnNumber, userId },
    include: RETURN_INCLUDE,
  });
}

/** Returns already filed against an order, for the "already returned" notice. */
export async function returnsForOrder(orderId: string) {
  return prisma.returnRequest.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
}

/**
 * Cancels a request the customer changed their mind about.
 *
 * Only while it is still `REQUESTED`: once approved, a label may exist and the
 * parcel may be moving, and cancelling from under that produces a return nobody
 * expects.
 */
export async function cancelReturn(userId: string, returnNumber: string): Promise<void> {
  const request = await prisma.returnRequest.findFirst({
    where: { returnNumber, userId },
    select: { id: true, status: true, orderId: true },
  });

  if (!request) throw errors.notFound('Return');

  if (!canTransition(request.status, 'CANCELLED')) {
    throw errors.conflict('This return can no longer be cancelled.');
  }

  await prisma.returnRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED' },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: request.orderId,
      type: 'NOTE_ADDED',
      message: `Return ${returnNumber} cancelled by the customer.`,
    },
  });
}

/**
 * Moves a return along.
 *
 * The seam the admin dashboard will drive. Refunding money is deliberately not
 * done here — that is `refundOrder` in the payment service, and folding a Stripe
 * call into this would hold a database lock across a network request.
 */
export async function transitionReturn(
  returnNumber: string,
  to: ReturnStatus,
  options: { reviewerNote?: string | null; refundCents?: number | null } = {},
) {
  const request = await prisma.returnRequest.findUnique({ where: { returnNumber } });
  if (!request) throw errors.notFound('Return');

  if (!canTransition(request.status, to)) {
    throw errors.conflict(`A return cannot go from ${request.status} to ${to}.`);
  }

  return prisma.returnRequest.update({
    where: { returnNumber },
    data: {
      status: to,
      reviewedAt: new Date(),
      reviewerNote: options.reviewerNote ?? request.reviewerNote,
      refundCents: options.refundCents ?? request.refundCents,
      ...(to === 'REFUNDED' ? { refundedAt: new Date() } : {}),
    },
  });
}

export type ReturnRecord = Awaited<ReturnType<typeof listReturns>>[number];
