import 'dotenv/config';

import { createScriptClient } from '../prisma/client';
import {
  MIN_REDEEMABLE_POINTS,
  pointsForOrder,
  pointsToCents,
} from '../src/features/account/rewards-rules';
import {
  awardForOrder,
  expirePoints,
  getRewardAccount,
  quoteRedemption,
  recalculateTier,
  reconcile,
  redeem,
  reverseForOrder,
  trailingSpendCents,
} from '../src/services/account/rewards.service';

/**
 * The loyalty programme, end to end against the live database.
 *
 * The pure rules are covered by unit tests; this proves the parts that only exist
 * once rows do — that earning is idempotent under a replayed webhook, that a
 * refund claws back what it paid and hands back what it took, that the ledger and
 * the cached balance never disagree, and that expiry cannot drive a balance
 * negative.
 *
 *   npm run verify:rewards
 *
 * Creates a customer and orders of its own and deletes them again.
 */
const prisma = createScriptClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const EMAIL = `rewards-verify-${Date.now()}@example.test`;

async function makeOrder(
  userId: string,
  subtotalCents: number,
  options: { discountCents?: number; daysAgo?: number } = {},
) {
  const discountCents = options.discountCents ?? 0;
  const placedAt = new Date(Date.now() - (options.daysAgo ?? 0) * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;

  return prisma.order.create({
    data: {
      orderNumber: `GT-RW-${rows[0]!.nextval}`,
      userId,
      email: EMAIL,
      status: 'PENDING',
      subtotalCents,
      discountCents,
      shippingCents: 0,
      taxCents: 0,
      totalCents: subtotalCents - discountCents,
      placedAt,
      paidAt: placedAt,
      createdAt: placedAt,
    },
  });
}

async function main(): Promise<void> {
  console.log('\nLoyalty programme\n');

  const role = await prisma.role.findUnique({ where: { key: 'CUSTOMER' } });
  if (!role) throw new Error('Run `npm run db:seed` first.');

  const user = await prisma.user.create({
    data: { email: EMAIL, firstName: 'Rewards', roles: { create: { roleId: role.id } } },
  });

  try {
    // ------------------------------------------------------------- earning
    console.log('Earning');

    const first = await makeOrder(user.id, 12_000);
    await prisma.order.update({ where: { id: first.id }, data: { status: 'PAID' } });

    const earned = await awardForOrder(first.id);
    const expected = pointsForOrder({ subtotalCents: 12_000, discountCents: 0, tier: 'STANDARD' });

    check('an order earns points', earned === expected, `${earned} vs expected ${expected}`);

    const afterFirst = await getRewardAccount(user.id);
    check('the balance reflects the award', afterFirst.pointsBalance === expected);

    const replay = await awardForOrder(first.id);
    check('a replayed award pays nothing the second time', replay === 0);

    const afterReplay = await getRewardAccount(user.id);
    check('a replay leaves the balance alone', afterReplay.pointsBalance === expected);

    const ledgerRows = await prisma.rewardTransaction.count({
      where: { userId: user.id, orderId: first.id, type: 'EARNED_PURCHASE' },
    });
    check('a replay writes only one ledger row', ledgerRows === 1, `${ledgerRows} rows`);

    const withExpiry = await prisma.rewardTransaction.findFirst({
      where: { userId: user.id, type: 'EARNED_PURCHASE' },
    });
    check('earned points carry an expiry date', withExpiry?.expiresAt !== null);

    // --------------------------------------------------------------- tiers
    console.log('\nTiers');

    check('spend counts towards a tier', (await trailingSpendCents(user.id)) === 12_000);
    check('a small spend stays standard', (await recalculateTier(user.id)) === 'STANDARD');

    const big = await makeOrder(user.id, 100_000);
    await prisma.order.update({ where: { id: big.id }, data: { status: 'PAID' } });

    // Awarded without recalculating first — this is the real sequence, and the
    // point of the check. `awardForOrder` reads the tier, pays at it, and only
    // then promotes, so the order that triggers a promotion earns at the old rate.
    const bigEarned = await awardForOrder(big.id);
    check(
      'the order that triggers a promotion earns at the old rate',
      bigEarned === pointsForOrder({ subtotalCents: 100_000, discountCents: 0, tier: 'STANDARD' }),
      `${bigEarned} points, expected ${pointsForOrder({ subtotalCents: 100_000, discountCents: 0, tier: 'STANDARD' })}`,
    );

    const promoted = await getRewardAccount(user.id);
    check('and the promotion lands straight after', promoted.tier === 'GOLD', promoted.tier);

    // The next order earns at the new rate.
    const afterPromotion = await makeOrder(user.id, 10_000);
    await prisma.order.update({ where: { id: afterPromotion.id }, data: { status: 'PAID' } });
    const goldEarned = await awardForOrder(afterPromotion.id);
    check(
      'the next order earns at the new rate',
      goldEarned === pointsForOrder({ subtotalCents: 10_000, discountCents: 0, tier: 'GOLD' }),
      `${goldEarned} points`,
    );

    // ---------------------------------------------------------- redemption
    console.log('\nRedemption');

    const balance = (await getRewardAccount(user.id)).pointsBalance;

    const quote = await quoteRedemption({
      userId: user.id,
      amountDueCents: 500_000,
      usePoints: true,
      useCredit: true,
    });

    check(
      'a quote offers the whole balance when the bill is larger',
      quote.points === balance,
      `${quote.points} of ${balance}`,
    );

    const capped = await quoteRedemption({
      userId: user.id,
      amountDueCents: 300,
      usePoints: true,
      useCredit: true,
    });
    check('a quote never exceeds the bill', capped.totalCents === 300);

    const guest = await quoteRedemption({
      userId: null,
      amountDueCents: 5000,
      usePoints: true,
      useCredit: true,
    });
    check('a guest is offered nothing', guest.totalCents === 0 && guest.available === null);

    const spend = await redeem({
      userId: user.id,
      points: MIN_REDEEMABLE_POINTS,
      description: 'Verification redemption',
    });
    check('redeeming succeeds', spend.ok);

    const afterSpend = await getRewardAccount(user.id);
    check(
      'redeeming reduces the balance',
      afterSpend.pointsBalance === balance - MIN_REDEEMABLE_POINTS,
    );

    const overspend = await redeem({
      userId: user.id,
      points: 9_999_999,
      description: 'Should be refused',
    });
    check('overspending is refused', !overspend.ok);

    // ------------------------------------------------------------- refunds
    console.log('\nRefunds');

    await prisma.order.update({
      where: { id: first.id },
      data: { creditAppliedCents: 250, pointsRedeemed: 100 },
    });

    const beforeRefund = await getRewardAccount(user.id);
    await reverseForOrder(first.id);
    const afterRefund = await getRewardAccount(user.id);

    check(
      'a refund claws back what the order earned',
      afterRefund.pointsBalance === beforeRefund.pointsBalance - expected + 100,
      `${beforeRefund.pointsBalance} -> ${afterRefund.pointsBalance}`,
    );
    check(
      'a refund hands back the credit the order spent',
      afterRefund.storeCreditCents === beforeRefund.storeCreditCents + 250,
    );

    await reverseForOrder(first.id);
    const afterSecondReverse = await getRewardAccount(user.id);
    check(
      'reversing twice changes nothing the second time',
      afterSecondReverse.pointsBalance === afterRefund.pointsBalance,
    );

    // ------------------------------------------------------------- expiry
    console.log('\nExpiry');

    await prisma.rewardTransaction.updateMany({
      where: { userId: user.id, type: 'EARNED_PURCHASE' },
      data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const swept = await expirePoints();
    check('the sweep expires overdue points', swept.points > 0, JSON.stringify(swept));

    const afterExpiry = await getRewardAccount(user.id);
    check('expiry never drives a balance negative', afterExpiry.pointsBalance >= 0);

    const expiredRow = await prisma.rewardTransaction.findFirst({
      where: { userId: user.id, type: 'EXPIRED' },
    });
    check('expiry is explained in the ledger', expiredRow !== null);

    const secondSweep = await expirePoints();
    check('a second sweep finds nothing left to expire', secondSweep.points === 0);

    // --------------------------------------------------------- the ledger
    console.log('\nThe ledger');

    const check1 = await reconcile(user.id);
    check(
      'the balance equals the sum of the ledger',
      check1.matches,
      `points ${check1.storedPoints} vs ${check1.ledgerPoints}, credit ${check1.storedCredit} vs ${check1.ledgerCredit}`,
    );

    check('points are worth what the rules say', pointsToCents(100) === 100);
  } finally {
    // --------------------------------------------------------------- cleanup
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const orderIds = orders.map((order) => order.id);

    await prisma.rewardTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.rewardAccount.deleteMany({ where: { userId: user.id } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
