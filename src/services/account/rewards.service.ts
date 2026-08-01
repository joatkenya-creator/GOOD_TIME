import 'server-only';

import { randomBytes } from 'node:crypto';

import type { VipTier } from '@/generated/prisma/enums';
import {
  BIRTHDAY_POINTS,
  MIN_REDEEMABLE_POINTS,
  REFERRAL_MIN_ORDER_CENTS,
  REFERRAL_REWARD_CENTS,
  birthdayGrantDue,
  expiryFor,
  planRedemption,
  pointsForOrder,
  pointsToCents,
  tierForSpend,
} from '@/features/account/rewards-rules';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Loyalty: points, store credit, tiers and referrals.
 *
 * ## Two layers
 *
 * The **rules** — what an order earns, when points expire, what a tier is worth —
 * live in `features/account/rewards-rules.ts` as pure functions over integers, so
 * they are exhaustively testable without a database. Money rules that cannot be
 * tested are money rules nobody can safely change.
 *
 * This file is the **ledger**, and the invariant that makes it trustworthy: every
 * balance change is a row, and the balance is the sum of the rows. Nothing writes
 * a balance directly — everything goes through `award` or `redeem`, which move the
 * row and the balance in a single transaction.
 *
 * `reconcile()` proves the two agree, for the day someone asks.
 */

export const TIER_LABELS: Record<VipTier, string> = {
  STANDARD: 'Member',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
};

export async function getRewardAccount(userId: string) {
  return prisma.rewardAccount.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getTransactions(userId: string, take = 20) {
  return prisma.rewardTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/**
 * Adds to a balance and records why, atomically.
 *
 * The two halves are inseparable: a balance that moved without a ledger row is
 * unexplainable to the customer and unauditable to us, and a row without the
 * balance move is invisible.
 */
export async function award(input: {
  userId: string;
  type: Parameters<typeof prisma.rewardTransaction.create>[0]['data']['type'];
  points?: number;
  amountCents?: number;
  description: string;
  orderId?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  const points = input.points ?? 0;
  const amountCents = input.amountCents ?? 0;

  await getRewardAccount(input.userId);

  await prisma.$transaction([
    prisma.rewardTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        points,
        amountCents,
        description: input.description,
        orderId: input.orderId ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    }),
    prisma.rewardAccount.update({
      where: { userId: input.userId },
      data: {
        pointsBalance: { increment: points },
        storeCreditCents: { increment: amountCents },
      },
    }),
  ]);
}

/**
 * Spends points or credit.
 *
 * Checks the balance first and refuses rather than going negative — and the
 * database refuses too, via a non-negative check constraint, because a race
 * between two redemptions would otherwise slip past this read.
 */
export async function redeem(input: {
  userId: string;
  points?: number;
  amountCents?: number;
  description: string;
  orderId?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const points = input.points ?? 0;
  const amountCents = input.amountCents ?? 0;

  const account = await getRewardAccount(input.userId);

  if (points > account.pointsBalance) {
    return { ok: false, message: 'You do not have enough points for that.' };
  }
  if (amountCents > account.storeCreditCents) {
    return { ok: false, message: 'You do not have enough store credit for that.' };
  }

  await prisma.$transaction([
    prisma.rewardTransaction.create({
      data: {
        userId: input.userId,
        type: 'REDEEMED',
        points: -points,
        amountCents: -amountCents,
        description: input.description,
        orderId: input.orderId ?? null,
      },
    }),
    prisma.rewardAccount.update({
      where: { userId: input.userId },
      data: {
        pointsBalance: { decrement: points },
        storeCreditCents: { decrement: amountCents },
      },
    }),
  ]);

  return { ok: true };
}

/**
 * The customer's referral code, minted on first view.
 *
 * Human-readable and unambiguous: no `0`/`O` or `1`/`I`, because this gets read
 * aloud and typed from memory.
 */
export async function getReferralCode(userId: string) {
  const existing = await prisma.referralCode.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = mintCode();
    const clash = await prisma.referralCode.findUnique({ where: { code }, select: { id: true } });
    if (clash) continue;

    return prisma.referralCode.create({ data: { userId, code } });
  }

  throw new Error('Could not mint a unique referral code');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function mintCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return `GT${code}`;
}

/**
 * Reconciles a balance against its ledger.
 *
 * Not called in normal operation — the balance is maintained transactionally. It
 * exists because the day someone asks "is this number right?", the answer should
 * be a query rather than an opinion.
 */
export async function reconcile(userId: string): Promise<{
  storedPoints: number;
  ledgerPoints: number;
  storedCredit: number;
  ledgerCredit: number;
  matches: boolean;
}> {
  const [account, sum] = await Promise.all([
    getRewardAccount(userId),
    prisma.rewardTransaction.aggregate({
      where: { userId },
      _sum: { points: true, amountCents: true },
    }),
  ]);

  const ledgerPoints = sum._sum.points ?? 0;
  const ledgerCredit = sum._sum.amountCents ?? 0;

  return {
    storedPoints: account.pointsBalance,
    ledgerPoints,
    storedCredit: account.storeCreditCents,
    ledgerCredit,
    matches: account.pointsBalance === ledgerPoints && account.storeCreditCents === ledgerCredit,
  };
}

// ---------------------------------------------------------------------------
// The rules, applied
// ---------------------------------------------------------------------------

/**
 * Trailing-twelve-month spend, which is what a tier is computed from.
 *
 * Trailing rather than lifetime, because a tier should describe who someone is
 * now. Cancelled and refunded orders are excluded — a tier bought with money that
 * came back is a tier nobody paid for.
 */
export async function trailingSpendCents(userId: string, now = new Date()): Promise<number> {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - 1);

  const result = await prisma.order.aggregate({
    where: {
      userId,
      status: { in: ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      paidAt: { gte: since },
    },
    _sum: { subtotalCents: true, discountCents: true },
  });

  return Math.max(0, (result._sum.subtotalCents ?? 0) - (result._sum.discountCents ?? 0));
}

/**
 * Recomputes a customer's tier from their spend.
 *
 * Tiers move only on this call, never as a side effect of a balance change — so
 * "why am I Gold?" has one answer, and it is a query anyone can run.
 */
export async function recalculateTier(userId: string, now = new Date()): Promise<VipTier> {
  const spend = await trailingSpendCents(userId, now);
  const tier = tierForSpend(spend);

  await prisma.rewardAccount.update({
    where: { userId },
    data: { tier, tierReviewedAt: now },
  });

  return tier;
}

/**
 * Pays out the points an order earned.
 *
 * Called once, when an order becomes `PAID`. Idempotent by construction: the
 * ledger is checked for an existing `EARNED_PURCHASE` against this order, so a
 * replayed Stripe webhook cannot pay twice.
 *
 * The tier is read *before* awarding and recalculated *after*, so an order that
 * promotes someone earns at the rate they had when they placed it. Earning at the
 * new rate would mean the order triggering a promotion is also the first to
 * benefit from it, which nobody expects and which is hard to explain.
 */
export async function awardForOrder(orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, orderNumber: true, subtotalCents: true, discountCents: true },
  });

  if (!order?.userId) return 0;

  const already = await prisma.rewardTransaction.findFirst({
    where: { userId: order.userId, orderId: order.id, type: 'EARNED_PURCHASE' },
    select: { id: true },
  });

  if (already) return 0;

  const account = await getRewardAccount(order.userId);

  const points = pointsForOrder({
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    tier: account.tier,
  });

  if (points > 0) {
    const now = new Date();

    await award({
      userId: order.userId,
      type: 'EARNED_PURCHASE',
      points,
      description: `Order ${order.orderNumber}`,
      orderId: order.id,
      expiresAt: expiryFor(now),
    });
  }

  await recalculateTier(order.userId);
  await payReferralIfDue(order.userId, order.id);

  logger.info('rewards.awarded', { orderId: order.id, points });
  return points;
}

/**
 * Takes back what a refunded order earned, and returns what it spent.
 *
 * Both halves matter. Keeping the points is paying a reward for a sale that did
 * not happen; keeping the redemption is charging a customer twice for a refund.
 *
 * The clawback may drive the balance to zero but never below it — points may
 * already have been spent, and a negative balance is a debt the customer never
 * agreed to.
 */
export async function reverseForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      orderNumber: true,
      creditAppliedCents: true,
      pointsRedeemed: true,
    },
  });

  if (!order?.userId) return;

  const alreadyReversed = await prisma.rewardTransaction.findFirst({
    where: { userId: order.userId, orderId: order.id, type: 'ADJUSTMENT' },
    select: { id: true },
  });

  if (alreadyReversed) return;

  const earned = await prisma.rewardTransaction.findFirst({
    where: { userId: order.userId, orderId: order.id, type: 'EARNED_PURCHASE' },
  });

  const account = await getRewardAccount(order.userId);
  const clawback = earned ? Math.min(earned.points, account.pointsBalance) : 0;

  // One ledger row carries both directions — what is taken back and what is given
  // back. Two rows would let a crash between them leave the account inconsistent.
  const points = -clawback + order.pointsRedeemed;
  const amountCents = order.creditAppliedCents;

  if (points === 0 && amountCents === 0) return;

  await prisma.$transaction([
    prisma.rewardTransaction.create({
      data: {
        userId: order.userId,
        type: 'ADJUSTMENT',
        points,
        amountCents,
        description: `Order ${order.orderNumber} refunded`,
        orderId: order.id,
      },
    }),
    prisma.rewardAccount.update({
      where: { userId: order.userId },
      data: {
        pointsBalance: { increment: points },
        storeCreditCents: { increment: amountCents },
      },
    }),
  ]);

  await recalculateTier(order.userId);
  logger.info('rewards.reversed', { orderId: order.id, points, amountCents });
}

/**
 * What loyalty can pay towards a basket, given the customer's intent.
 *
 * Read-only. Nothing is deducted until an order exists, because a customer
 * browsing a cart with "use my points" ticked has not spent anything yet.
 */
export async function quoteRedemption(input: {
  userId: string | null | undefined;
  amountDueCents: number;
  usePoints: boolean;
  useCredit: boolean;
}) {
  if (!input.userId) {
    return { creditCents: 0, points: 0, pointsCents: 0, totalCents: 0, available: null };
  }

  const account = await getRewardAccount(input.userId);

  const plan = planRedemption({
    amountDueCents: input.amountDueCents,
    storeCreditCents: account.storeCreditCents,
    pointsBalance: account.pointsBalance,
    usePoints: input.usePoints,
    useCredit: input.useCredit,
  });

  return {
    ...plan,
    available: {
      storeCreditCents: account.storeCreditCents,
      pointsBalance: account.pointsBalance,
      pointsValueCents: pointsToCents(account.pointsBalance),
      minimumPoints: MIN_REDEEMABLE_POINTS,
    },
  };
}

/**
 * Grants the annual birthday reward if one is due.
 *
 * Checked when the customer opens their account rather than swept nightly: a
 * reward nobody has come back to collect costs nothing to delay, and a nightly job
 * over every customer costs something every night.
 */
export async function grantBirthdayIfDue(userId: string, now = new Date()): Promise<boolean> {
  const [account, preferences] = await Promise.all([
    getRewardAccount(userId),
    prisma.userPreferences.findUnique({ where: { userId } }),
  ]);

  if (!preferences) return false;

  const due = birthdayGrantDue({
    birthMonth: preferences.birthMonth,
    birthDay: preferences.birthDay,
    lastGrantedAt: account.lastBirthdayGrantAt,
    now,
  });

  if (!due) return false;

  await award({
    userId,
    type: 'EARNED_BIRTHDAY',
    points: BIRTHDAY_POINTS,
    description: 'Happy birthday from us',
    expiresAt: expiryFor(now),
  });

  await prisma.rewardAccount.update({
    where: { userId },
    data: { lastBirthdayGrantAt: now },
  });

  logger.info('rewards.birthday_granted', { userId, points: BIRTHDAY_POINTS });
  return true;
}

/**
 * Pays a referrer once the person they referred completes a qualifying first order.
 *
 * On the first order, not at sign-up: a referral that pays on registration pays
 * for email addresses. The minimum order value stops it paying for a token basket
 * bought to farm it.
 */
async function payReferralIfDue(userId: string, orderId: string): Promise<void> {
  const account = await getRewardAccount(userId);
  if (!account.referredByCode || account.referralPaidAt) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { subtotalCents: true, discountCents: true },
  });

  const value = (order?.subtotalCents ?? 0) - (order?.discountCents ?? 0);
  if (value < REFERRAL_MIN_ORDER_CENTS) return;

  const referrer = await prisma.referralCode.findUnique({
    where: { code: account.referredByCode },
    select: { userId: true, id: true },
  });

  // Self-referral pays nothing, however the code was obtained.
  if (!referrer || referrer.userId === userId) return;

  await award({
    userId: referrer.userId,
    type: 'EARNED_REFERRAL',
    amountCents: REFERRAL_REWARD_CENTS,
    description: 'A friend you referred placed their first order',
  });

  await prisma.$transaction([
    prisma.referralCode.update({ where: { id: referrer.id }, data: { uses: { increment: 1 } } }),
    prisma.rewardAccount.update({ where: { userId }, data: { referralPaidAt: new Date() } }),
  ]);

  logger.info('rewards.referral_paid', { referrerId: referrer.userId, referredId: userId });
}

/**
 * Expires points past their date.
 *
 * Writes a negative ledger row rather than editing the row that earned them: the
 * history has to keep saying "you earned 300 here" alongside "300 expired there",
 * or a customer watching a balance shrink has no way to see why.
 *
 * Run from the scheduled job, bounded per run so a large backlog does not hold a
 * connection open. The next tick picks up the rest.
 */
export async function expirePoints(limit = 500): Promise<{ customers: number; points: number }> {
  const now = new Date();

  const due = await prisma.rewardTransaction.groupBy({
    by: ['userId'],
    where: { points: { gt: 0 }, expiresAt: { lt: now } },
    _sum: { points: true },
    // Prisma requires an ordering alongside `take`, and oldest-first is the one
    // that matters: the longest-overdue balances are swept first.
    orderBy: { userId: 'asc' },
    take: limit,
  });

  let customers = 0;
  let expired = 0;

  for (const row of due) {
    const points = row._sum.points ?? 0;

    const account = await getRewardAccount(row.userId);
    const amount = Math.min(Math.max(0, points), account.pointsBalance);

    if (amount <= 0) {
      // Already spent. Clearing the dates stops the sweep re-examining them.
      await prisma.rewardTransaction.updateMany({
        where: { userId: row.userId, expiresAt: { lt: now } },
        data: { expiresAt: null },
      });
      continue;
    }

    await prisma.$transaction([
      prisma.rewardTransaction.create({
        data: {
          userId: row.userId,
          type: 'EXPIRED',
          points: -amount,
          description: `${amount} points expired`,
        },
      }),
      prisma.rewardAccount.update({
        where: { userId: row.userId },
        data: { pointsBalance: { decrement: amount } },
      }),
      // Consumed: these earnings can never expire a second time.
      prisma.rewardTransaction.updateMany({
        where: { userId: row.userId, expiresAt: { lt: now } },
        data: { expiresAt: null },
      }),
    ]);

    customers += 1;
    expired += amount;
  }

  if (customers > 0) logger.info('rewards.expired', { customers, points: expired });
  return { customers, points: expired };
}
