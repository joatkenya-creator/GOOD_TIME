import type { VipTier } from '@/generated/prisma/enums';

/**
 * The loyalty programme's rules.
 *
 * Pure functions over integers, no database and no dates from `Date.now()` — every
 * function that needs "now" takes it as an argument. That is what makes the rules
 * exhaustively testable, and money rules that cannot be tested are money rules
 * nobody can safely change.
 *
 * ## The numbers, and why these ones
 *
 * A point is worth **one cent** on redemption and is earned at **one point per
 * dollar of goods**, so the base programme returns 1% — the low end of what US
 * retail loyalty pays, chosen because it is affordable at this store's margins and
 * can be raised without anyone feeling cheated. Raising a rate is a promotion;
 * cutting one is a complaint.
 *
 * Tier multipliers top out at 2×, so the best customers earn 2%. Thresholds are
 * trailing-twelve-month spend rather than lifetime, because a tier should describe
 * who someone is now, not who they were three years ago.
 *
 * Every constant below is a **pricing decision with real margin attached**. Change
 * them here, in one place, with the tests in `tests/rewards-rules.test.ts` to catch
 * what a change breaks.
 */

/** Cents of value one point is worth when redeemed. */
export const POINT_VALUE_CENTS = 1;

/** Points earned per whole dollar of goods, before tier multipliers. */
export const POINTS_PER_DOLLAR = 1;

/**
 * Redemption floor.
 *
 * Below this the discount is pennies and the friction of choosing to spend them is
 * worth more than the money. It also stops the balance being nibbled to nothing in
 * amounts nobody notices.
 */
export const MIN_REDEEMABLE_POINTS = 500;

/** Points expire this long after being earned. */
export const POINTS_EXPIRY_MONTHS = 24;

/** Granted once per calendar year, on or after the customer's birthday. */
export const BIRTHDAY_POINTS = 500;

/** Paid to the referrer once the person they referred completes a first order. */
export const REFERRAL_REWARD_CENTS = 1000;

/** Minimum order value before a referral pays out, so it cannot be farmed. */
export const REFERRAL_MIN_ORDER_CENTS = 3000;

/**
 * Tier thresholds, in cents of trailing-twelve-month spend.
 *
 * Ordered highest first: `tierForSpend` takes the first one reached.
 */
export const TIERS: { tier: VipTier; minSpendCents: number; multiplier: number }[] = [
  { tier: 'PLATINUM', minSpendCents: 200_000, multiplier: 2 },
  { tier: 'GOLD', minSpendCents: 75_000, multiplier: 1.5 },
  { tier: 'SILVER', minSpendCents: 25_000, multiplier: 1.25 },
  { tier: 'STANDARD', minSpendCents: 0, multiplier: 1 },
];

export function tierForSpend(spendCents: number): VipTier {
  return TIERS.find((entry) => spendCents >= entry.minSpendCents)?.tier ?? 'STANDARD';
}

export function multiplierForTier(tier: VipTier): number {
  return TIERS.find((entry) => entry.tier === tier)?.multiplier ?? 1;
}

/** Spend still needed for the next tier up, or null at the top. */
export function nextTier(spendCents: number): { tier: VipTier; remainingCents: number } | null {
  const current = tierForSpend(spendCents);
  const index = TIERS.findIndex((entry) => entry.tier === current);

  // TIERS is ordered highest first, so the next tier up is the previous entry.
  const target = TIERS[index - 1];
  if (!target) return null;

  return { tier: target.tier, remainingCents: target.minSpendCents - spendCents };
}

/**
 * Points earned by an order.
 *
 * Goods only — shipping and tax are excluded because neither is margin we can pay
 * a reward out of, and rewarding tax would mean a customer in a high-tax state
 * earns more for the same basket.
 *
 * The discounted subtotal is what counts: a coupon already gave that value away
 * once, and paying points on it gives it away twice.
 *
 * Rounded down. Partial dollars do not earn, which keeps the arithmetic honest in
 * the direction that never over-promises.
 */
export function pointsForOrder(input: {
  subtotalCents: number;
  discountCents: number;
  tier: VipTier;
}): number {
  const eligible = Math.max(0, input.subtotalCents - input.discountCents);
  const base = Math.floor(eligible / 100) * POINTS_PER_DOLLAR;

  return Math.floor(base * multiplierForTier(input.tier));
}

/** Cash value of a points balance. */
export function pointsToCents(points: number): number {
  return Math.max(0, Math.floor(points)) * POINT_VALUE_CENTS;
}

/** Points needed to cover an amount, rounded up so the amount is fully covered. */
export function centsToPoints(cents: number): number {
  return Math.max(0, Math.ceil(cents / POINT_VALUE_CENTS));
}

/**
 * How much of a bill points and credit may cover.
 *
 * Store credit is applied first — it does not expire and has no minimum, so
 * spending it before points is strictly better for the customer.
 *
 * Neither may cover shipping or tax, and the total is capped at the amount due.
 * A customer cannot pay themselves.
 */
export function planRedemption(input: {
  amountDueCents: number;
  storeCreditCents: number;
  pointsBalance: number;
  usePoints: boolean;
  useCredit: boolean;
}): { creditCents: number; points: number; pointsCents: number; totalCents: number } {
  const creditCents = input.useCredit ? Math.min(input.storeCreditCents, input.amountDueCents) : 0;

  const remaining = input.amountDueCents - creditCents;

  const redeemable =
    input.usePoints && input.pointsBalance >= MIN_REDEEMABLE_POINTS ? input.pointsBalance : 0;

  const pointsCents = Math.min(pointsToCents(redeemable), remaining);
  const points = centsToPoints(pointsCents);

  return { creditCents, points, pointsCents, totalCents: creditCents + pointsCents };
}

/** When points earned now should expire. */
export function expiryFor(earnedAt: Date): Date {
  const expires = new Date(earnedAt);
  expires.setMonth(expires.getMonth() + POINTS_EXPIRY_MONTHS);
  return expires;
}

/**
 * Whether a birthday grant is due.
 *
 * Once per calendar year, on or after the day. Someone who joins in December and
 * has a January birthday waits three weeks, not a year — the check is "has this
 * year's birthday passed and not been paid", not "has a year elapsed".
 */
export function birthdayGrantDue(input: {
  birthMonth: number | null;
  birthDay: number | null;
  lastGrantedAt: Date | null;
  now: Date;
}): boolean {
  if (!input.birthMonth || !input.birthDay) return false;

  const year = input.now.getFullYear();
  const birthdayThisYear = new Date(year, input.birthMonth - 1, input.birthDay);

  if (input.now < birthdayThisYear) return false;
  if (!input.lastGrantedAt) return true;

  return input.lastGrantedAt.getFullYear() < year;
}
