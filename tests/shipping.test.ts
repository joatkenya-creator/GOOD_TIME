import { describe, expect, it } from 'vitest';

import { estimateDelivery, isEligible, priceFor } from '@/services/shipping.service';

/**
 * Shipping rate pricing and eligibility.
 *
 * These are the pure halves of the service — no database — and they decide what a
 * customer is charged for delivery. The free-shipping threshold in particular has
 * to win over every surcharge, or an order that qualified for free delivery still
 * gets billed for weight.
 */
const rate = (overrides: Partial<Parameters<typeof priceFor>[0]> = {}) =>
  ({
    id: 'r1',
    code: 'standard',
    name: 'Standard',
    description: null,
    type: 'FLAT',
    baseCents: 599,
    perKgCents: 0,
    freeWeightGrams: 0,
    freeAboveSubtotalCents: null,
    minSubtotalCents: null,
    states: [],
    countries: ['US'],
    estimatedDaysMin: 5,
    estimatedDaysMax: 7,
    carrier: 'USPS',
    isActive: true,
    position: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as Parameters<typeof priceFor>[0];

const basket = (subtotalCents: number, totalWeightGrams = 0, state?: string) => ({
  subtotalCents,
  totalWeightGrams,
  state,
});

describe('priceFor', () => {
  it('charges the flat base rate', () => {
    expect(priceFor(rate(), basket(5000))).toBe(599);
  });

  it('is always zero for a FREE rate', () => {
    expect(priceFor(rate({ type: 'FREE', baseCents: 999 }), basket(100))).toBe(0);
  });

  it('adds a per-kilogram charge above the included weight', () => {
    // 3200g total, 2000g included -> 1200g billable -> 2 started kilos.
    const weighted = rate({
      type: 'WEIGHT_BASED',
      baseCents: 999,
      perKgCents: 450,
      freeWeightGrams: 2000,
    });
    expect(priceFor(weighted, basket(5000, 3200))).toBe(999 + 900);
  });

  it('bills per *started* kilogram, as carriers do', () => {
    const weighted = rate({
      type: 'WEIGHT_BASED',
      baseCents: 0,
      perKgCents: 500,
      freeWeightGrams: 0,
    });
    expect(priceFor(weighted, basket(5000, 1))).toBe(500);
    expect(priceFor(weighted, basket(5000, 1000))).toBe(500);
    expect(priceFor(weighted, basket(5000, 1001))).toBe(1000);
  });

  it('never charges for weight below the included allowance', () => {
    const weighted = rate({
      type: 'WEIGHT_BASED',
      baseCents: 999,
      perKgCents: 450,
      freeWeightGrams: 2000,
    });
    expect(priceFor(weighted, basket(5000, 1500))).toBe(999);
  });

  it('zeroes the charge at the free-shipping threshold', () => {
    const free = rate({ freeAboveSubtotalCents: 5900 });
    expect(priceFor(free, basket(5899))).toBe(599);
    expect(priceFor(free, basket(5900))).toBe(0);
  });

  it('lets the free threshold beat a weight surcharge', () => {
    // The bug this guards: applying the threshold before the surcharge leaves a
    // qualifying order still paying for weight.
    const weighted = rate({
      type: 'WEIGHT_BASED',
      baseCents: 999,
      perKgCents: 450,
      freeWeightGrams: 0,
      freeAboveSubtotalCents: 5900,
    });
    expect(priceFor(weighted, basket(9000, 5000))).toBe(0);
  });
});

describe('isEligible', () => {
  it('rejects an inactive rate', () => {
    expect(isEligible(rate({ isActive: false }), basket(5000))).toBe(false);
  });

  it('honours a minimum subtotal', () => {
    const premium = rate({ minSubtotalCents: 10_000 });
    expect(isEligible(premium, basket(9999))).toBe(false);
    expect(isEligible(premium, basket(10_000))).toBe(true);
  });

  it('treats an empty state list as "everywhere we ship"', () => {
    expect(isEligible(rate({ states: [] }), basket(5000, 0, 'AK'))).toBe(true);
  });

  it('restricts to the listed states when the list is populated', () => {
    const contiguous = rate({ states: ['CA', 'NY'] });
    expect(isEligible(contiguous, basket(5000, 0, 'CA'))).toBe(true);
    expect(isEligible(contiguous, basket(5000, 0, 'AK'))).toBe(false);
  });

  it('matches a state case-insensitively', () => {
    expect(isEligible(rate({ states: ['CA'] }), basket(5000, 0, 'ca'))).toBe(true);
  });

  it('rejects a state-restricted rate when no destination is known yet', () => {
    // Better to hide an option than to quote a price we cannot honour.
    expect(isEligible(rate({ states: ['CA'] }), basket(5000))).toBe(false);
  });

  it('rejects a country we do not ship that rate to', () => {
    expect(isEligible(rate({ countries: ['US'] }), { ...basket(5000), country: 'CA' })).toBe(false);
  });
});

describe('estimateDelivery', () => {
  it('counts business days only', () => {
    // Thursday 2026-07-30 + 3 business days = Tuesday 2026-08-04.
    const thursday = new Date('2026-07-30T12:00:00Z');
    const { latest } = estimateDelivery(1, 3, thursday);

    expect(latest.getUTCDate()).toBe(4);
    expect(latest.getUTCMonth()).toBe(7); // August
  });

  it('never lands on a weekend', () => {
    const friday = new Date('2026-07-31T12:00:00Z');

    for (let days = 1; days <= 10; days += 1) {
      const { latest } = estimateDelivery(days, days, friday);
      expect([0, 6]).not.toContain(latest.getDay());
    }
  });
});
