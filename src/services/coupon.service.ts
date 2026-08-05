import 'server-only';

import type { CouponModel as Coupon } from '@/generated/prisma/models';
import type { DiscountInput } from '@/features/checkout/totals';
import { prisma } from '@/lib/prisma';

/**
 * Coupon validation and redemption.
 *
 * Every rule is enforced here, server-side, on every price calculation â€” not
 * once when the code is typed. A coupon applied to a $100 cart that is then
 * emptied to $20 must stop qualifying for a "$50 off orders over $75" offer, and
 * the only way to guarantee that is to re-validate at the moment of charge.
 */

export type CouponRejection =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'USER_LIMIT_REACHED'
  | 'MINIMUM_NOT_MET'
  | 'WRONG_CUSTOMER'
  | 'FIRST_ORDER_ONLY';

export type CouponResult =
  | { ok: true; coupon: Coupon; discount: DiscountInput }
  | { ok: false; reason: CouponRejection; message: string };

/** Customer-facing copy. Deliberately vague about *why* a private code failed. */
const MESSAGES: Record<CouponRejection, string> = {
  NOT_FOUND: 'That code is not valid.',
  INACTIVE: 'That code is no longer active.',
  NOT_STARTED: 'That code is not active yet.',
  EXPIRED: 'That code has expired.',
  USAGE_LIMIT_REACHED: 'That code has reached its usage limit.',
  USER_LIMIT_REACHED: 'You have already used that code.',
  MINIMUM_NOT_MET: 'Your order does not meet the minimum for that code.',
  // Same wording as NOT_FOUND on purpose: confirming a code exists but belongs
  // to someone else turns the coupon table into an enumeration oracle.
  WRONG_CUSTOMER: 'That code is not valid.',
  FIRST_ORDER_ONLY: 'That code is only valid on a first order.',
};

export interface CouponContext {
  subtotalCents: number;
  userId?: string | null;
}

function reject(reason: CouponRejection): CouponResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** Maps a coupon row onto the discount shape the totals engine understands. */
export function toDiscount(coupon: Coupon): DiscountInput {
  return {
    kind: coupon.type,
    value: coupon.value,
    maxDiscountCents: coupon.maxDiscountCents,
  };
}

/**
 * Validates a code against a basket.
 *
 * Codes are matched case-insensitively â€” customers type `save10`, marketing
 * prints `SAVE10`, and rejecting one of them is a self-inflicted support ticket.
 */
export async function validateCoupon(code: string, context: CouponContext): Promise<CouponResult> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return reject('NOT_FOUND');

  const coupon = await prisma.coupon.findFirst({
    where: { code: { equals: normalized, mode: 'insensitive' } },
  });

  if (!coupon) return reject('NOT_FOUND');
  if (!coupon.isActive) return reject('INACTIVE');

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return reject('NOT_STARTED');
  if (coupon.endsAt && coupon.endsAt < now) return reject('EXPIRED');

  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return reject('USAGE_LIMIT_REACHED');
  }

  if (coupon.minSubtotalCents != null && context.subtotalCents < coupon.minSubtotalCents) {
    return reject('MINIMUM_NOT_MET');
  }

  // Customer-specific: a guest can never redeem one, and neither can a different
  // signed-in customer.
  if (coupon.userId && coupon.userId !== context.userId) return reject('WRONG_CUSTOMER');

  if (context.userId) {
    if (coupon.usageLimitPerUser != null) {
      const used = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId: context.userId },
      });
      if (used >= coupon.usageLimitPerUser) return reject('USER_LIMIT_REACHED');
    }

    if (coupon.firstOrderOnly) {
      const previous = await prisma.order.count({
        where: { userId: context.userId, status: { notIn: ['CANCELLED', 'PENDING'] } },
      });
      if (previous > 0) return reject('FIRST_ORDER_ONLY');
    }
  } else if (coupon.firstOrderOnly === false && coupon.usageLimitPerUser != null) {
    // A per-user limit is unenforceable for a guest. Allowing it would let one
    // person redeem a single-use code indefinitely by not signing in.
    return reject('USER_LIMIT_REACHED');
  }

  return { ok: true, coupon, discount: toDiscount(coupon) };
}

/**
 * Records a redemption and increments the counter, atomically with the order.
 *
 * Must run inside the same transaction that creates the order: incrementing
 * separately means a failed order still burns a single-use code, and a crash
 * between the two lets a limited code be redeemed twice.
 */
export async function recordRedemption(
  tx: Pick<typeof prisma, 'couponRedemption' | 'coupon'>,
  input: { couponId: string; orderId: string; userId?: string | null; discountCents: number },
): Promise<void> {
  await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      orderId: input.orderId,
      userId: input.userId ?? null,
      discountCents: input.discountCents,
    },
  });

  await tx.coupon.update({
    where: { id: input.couponId },
    data: { usedCount: { increment: 1 } },
  });
}

/** Reverses a redemption when an order is cancelled before payment. */
export async function releaseRedemption(orderId: string): Promise<void> {
  const redemption = await prisma.couponRedemption.findFirst({ where: { orderId } });
  if (!redemption) return;

  await prisma.$transaction([
    prisma.couponRedemption.delete({
      where: { couponId_orderId: { couponId: redemption.couponId, orderId } },
    }),
    prisma.coupon.update({
      where: { id: redemption.couponId },
      data: { usedCount: { decrement: 1 } },
    }),
  ]);
}
