import { describe, expect, it } from 'vitest';

import {
  BIRTHDAY_POINTS,
  MIN_REDEEMABLE_POINTS,
  POINT_VALUE_CENTS,
  birthdayGrantDue,
  centsToPoints,
  expiryFor,
  multiplierForTier,
  nextTier,
  planRedemption,
  pointsForOrder,
  pointsToCents,
  tierForSpend,
} from '@/features/account/rewards-rules';

/**
 * The loyalty rules.
 *
 * These decide what a customer is owed, so every case below is one a real
 * programme eventually hits: a coupon that already gave value away, a tier
 * boundary, a redemption larger than the bill, a birthday in December.
 */

describe('tierForSpend', () => {
  it('starts everyone at standard', () => {
    expect(tierForSpend(0)).toBe('STANDARD');
    expect(tierForSpend(24_999)).toBe('STANDARD');
  });

  it('promotes exactly at each threshold', () => {
    expect(tierForSpend(25_000)).toBe('SILVER');
    expect(tierForSpend(75_000)).toBe('GOLD');
    expect(tierForSpend(200_000)).toBe('PLATINUM');
  });

  it('does not promote a cent early', () => {
    expect(tierForSpend(74_999)).toBe('SILVER');
    expect(tierForSpend(199_999)).toBe('GOLD');
  });
});

describe('nextTier', () => {
  it('reports what is left to reach the next tier', () => {
    expect(nextTier(0)).toEqual({ tier: 'SILVER', remainingCents: 25_000 });
    expect(nextTier(30_000)).toEqual({ tier: 'GOLD', remainingCents: 45_000 });
  });

  it('returns nothing at the top', () => {
    expect(nextTier(500_000)).toBeNull();
  });
});

describe('pointsForOrder', () => {
  it('pays one point per dollar of goods', () => {
    expect(pointsForOrder({ subtotalCents: 10_000, discountCents: 0, tier: 'STANDARD' })).toBe(100);
  });

  it('ignores partial dollars rather than rounding up', () => {
    expect(pointsForOrder({ subtotalCents: 10_099, discountCents: 0, tier: 'STANDARD' })).toBe(100);
  });

  it('does not pay on value a coupon already gave away', () => {
    // $100 basket, $20 off — points are earned on the $80 actually paid.
    expect(pointsForOrder({ subtotalCents: 10_000, discountCents: 2000, tier: 'STANDARD' })).toBe(
      80,
    );
  });

  it('applies the tier multiplier', () => {
    expect(pointsForOrder({ subtotalCents: 10_000, discountCents: 0, tier: 'SILVER' })).toBe(125);
    expect(pointsForOrder({ subtotalCents: 10_000, discountCents: 0, tier: 'GOLD' })).toBe(150);
    expect(pointsForOrder({ subtotalCents: 10_000, discountCents: 0, tier: 'PLATINUM' })).toBe(200);
  });

  it('rounds a multiplied total down', () => {
    // 1.25 × 33 = 41.25
    expect(pointsForOrder({ subtotalCents: 3399, discountCents: 0, tier: 'SILVER' })).toBe(41);
  });

  it('never pays on a discount larger than the subtotal', () => {
    expect(pointsForOrder({ subtotalCents: 3000, discountCents: 5000, tier: 'GOLD' })).toBe(0);
  });

  it('pays nothing on an empty order', () => {
    expect(pointsForOrder({ subtotalCents: 0, discountCents: 0, tier: 'PLATINUM' })).toBe(0);
  });
});

describe('points and cents convert both ways', () => {
  it('values a point at one cent', () => {
    expect(pointsToCents(500)).toBe(500 * POINT_VALUE_CENTS);
    expect(centsToPoints(500)).toBe(500 / POINT_VALUE_CENTS);
  });

  it('rounds a conversion up so an amount is always fully covered', () => {
    // Never leave a cent unpaid because of rounding.
    expect(centsToPoints(1)).toBe(1);
  });

  it('refuses to make value out of a negative balance', () => {
    expect(pointsToCents(-100)).toBe(0);
    expect(centsToPoints(-100)).toBe(0);
  });
});

describe('planRedemption', () => {
  const base = {
    amountDueCents: 10_000,
    storeCreditCents: 1500,
    pointsBalance: 2000,
    usePoints: true,
    useCredit: true,
  };

  it('spends store credit before points', () => {
    // Credit does not expire and has no minimum, so spending it first is
    // strictly better for the customer.
    const plan = planRedemption(base);
    expect(plan.creditCents).toBe(1500);
    expect(plan.pointsCents).toBe(2000);
    expect(plan.totalCents).toBe(3500);
  });

  it('never covers more than the amount due', () => {
    const plan = planRedemption({ ...base, amountDueCents: 1000 });
    expect(plan.totalCents).toBe(1000);
    expect(plan.creditCents).toBe(1000);
    expect(plan.pointsCents).toBe(0);
  });

  it('honours the redemption floor', () => {
    const plan = planRedemption({ ...base, pointsBalance: MIN_REDEEMABLE_POINTS - 1 });
    expect(plan.pointsCents).toBe(0);
  });

  it('redeems exactly at the floor', () => {
    const plan = planRedemption({
      ...base,
      useCredit: false,
      pointsBalance: MIN_REDEEMABLE_POINTS,
    });
    expect(plan.points).toBe(MIN_REDEEMABLE_POINTS);
  });

  it('respects each opt-out independently', () => {
    expect(planRedemption({ ...base, useCredit: false }).creditCents).toBe(0);
    expect(planRedemption({ ...base, usePoints: false }).pointsCents).toBe(0);
    expect(planRedemption({ ...base, usePoints: false, useCredit: false }).totalCents).toBe(0);
  });

  it('never lets a customer pay themselves', () => {
    const plan = planRedemption({
      amountDueCents: 500,
      storeCreditCents: 99_999,
      pointsBalance: 99_999,
      usePoints: true,
      useCredit: true,
    });
    expect(plan.totalCents).toBe(500);
  });
});

describe('expiryFor', () => {
  it('expires points two years after they are earned', () => {
    const earned = new Date('2026-08-01T00:00:00Z');
    expect(expiryFor(earned).getFullYear()).toBe(2028);
    expect(expiryFor(earned).getMonth()).toBe(earned.getMonth());
  });
});

describe('birthdayGrantDue', () => {
  const birthday = { birthMonth: 6, birthDay: 14 };

  it('is not due before the birthday', () => {
    expect(birthdayGrantDue({ ...birthday, lastGrantedAt: null, now: new Date(2026, 5, 13) })).toBe(
      false,
    );
  });

  it('is due on the day', () => {
    expect(birthdayGrantDue({ ...birthday, lastGrantedAt: null, now: new Date(2026, 5, 14) })).toBe(
      true,
    );
  });

  it('is not due twice in one year', () => {
    expect(
      birthdayGrantDue({
        ...birthday,
        lastGrantedAt: new Date(2026, 5, 14),
        now: new Date(2026, 11, 1),
      }),
    ).toBe(false);
  });

  it('is due again the following year', () => {
    expect(
      birthdayGrantDue({
        ...birthday,
        lastGrantedAt: new Date(2026, 5, 14),
        now: new Date(2027, 5, 14),
      }),
    ).toBe(true);
  });

  it('does not wait a year for someone who joins after their birthday', () => {
    // Joined in December, birthday in June: the next grant is the following June,
    // not twelve months from joining.
    expect(birthdayGrantDue({ ...birthday, lastGrantedAt: null, now: new Date(2027, 5, 20) })).toBe(
      true,
    );
  });

  it('needs a birthday to be set', () => {
    expect(
      birthdayGrantDue({
        birthMonth: null,
        birthDay: null,
        lastGrantedAt: null,
        now: new Date(2026, 5, 14),
      }),
    ).toBe(false);
  });
});

describe('the constants are internally consistent', () => {
  it('makes the redemption floor worth a sensible amount', () => {
    // If the floor is worth less than a dollar it is not worth a UI control.
    expect(pointsToCents(MIN_REDEEMABLE_POINTS)).toBeGreaterThanOrEqual(100);
  });

  it('pays a birthday grant worth something', () => {
    expect(pointsToCents(BIRTHDAY_POINTS)).toBeGreaterThan(0);
  });

  it('gives every tier a multiplier of at least one', () => {
    for (const tier of ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'] as const) {
      expect(multiplierForTier(tier)).toBeGreaterThanOrEqual(1);
    }
  });
});
