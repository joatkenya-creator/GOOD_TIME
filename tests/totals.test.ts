import { describe, expect, it } from 'vitest';

import {
  assertChargeable,
  computeTotals,
  discountAmountCents,
  roundCents,
  subtotalOf,
} from '@/features/checkout/totals';

/**
 * The arithmetic that decides what a customer is charged.
 *
 * Every case here is one an ecommerce team eventually hits in production: a
 * coupon worth more than the basket, tax on a discounted subtotal, a state that
 * taxes shipping, combined state-plus-county rates. Getting any of them wrong is
 * either a refund queue or an audit finding.
 */
const line = (unitPriceCents: number, quantity = 1, weightGrams = 0) => ({
  unitPriceCents,
  quantity,
  weightGrams,
});

describe('roundCents', () => {
  it('rounds half away from zero in both directions', () => {
    // Math.round(-0.5) is -0, which quietly loses a cent on refunds.
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(1.4)).toBe(1);
    expect(roundCents(1.6)).toBe(2);
  });
});

describe('subtotalOf', () => {
  it('multiplies by quantity', () => {
    expect(subtotalOf([line(1999, 3), line(500, 2)])).toBe(1999 * 3 + 1000);
  });

  it('is zero for an empty basket', () => {
    expect(subtotalOf([])).toBe(0);
  });
});

describe('discountAmountCents', () => {
  it('takes a percentage of the subtotal', () => {
    expect(discountAmountCents(10_000, { kind: 'PERCENTAGE', value: 15 })).toBe(1500);
  });

  it('rounds a percentage to the nearest cent', () => {
    // 33% of $19.99 = 659.67c
    expect(discountAmountCents(1999, { kind: 'PERCENTAGE', value: 33 })).toBe(660);
  });

  it('honours a percentage cap', () => {
    expect(
      discountAmountCents(50_000, { kind: 'PERCENTAGE', value: 50, maxDiscountCents: 2000 }),
    ).toBe(2000);
  });

  it('never discounts more than the subtotal', () => {
    // A $50 coupon on a $30 order is $30 off, not a $20 payout.
    expect(discountAmountCents(3000, { kind: 'FIXED_AMOUNT', value: 5000 })).toBe(3000);
  });

  it('returns nothing for free shipping — that is not a subtotal discount', () => {
    expect(discountAmountCents(10_000, { kind: 'FREE_SHIPPING', value: 0 })).toBe(0);
  });

  it('returns nothing on an empty basket', () => {
    expect(discountAmountCents(0, { kind: 'PERCENTAGE', value: 20 })).toBe(0);
  });
});

describe('computeTotals', () => {
  it('sums a plain order', () => {
    const totals = computeTotals({ lines: [line(2500, 2)], shippingCents: 599 });

    expect(totals.subtotalCents).toBe(5000);
    expect(totals.shippingCents).toBe(599);
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(5599);
    expect(totals.itemCount).toBe(2);
  });

  it('taxes the discounted subtotal, not the original', () => {
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 0,
      discount: { kind: 'PERCENTAGE', value: 20 },
      taxJurisdictions: [
        { label: 'CA state', rateBasisPoints: 725, appliesToShipping: false },
      ],
    });

    expect(totals.discountCents).toBe(2000);
    // 7.25% of $80, not of $100.
    expect(totals.taxCents).toBe(580);
    expect(totals.totalCents).toBe(8580);
  });

  it('excludes shipping from tax where the jurisdiction does not tax it', () => {
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 1000,
      taxJurisdictions: [{ label: 'No ship tax', rateBasisPoints: 1000, appliesToShipping: false }],
    });

    expect(totals.taxCents).toBe(1000); // 10% of goods only
  });

  it('includes shipping in tax where the jurisdiction taxes it', () => {
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 1000,
      taxJurisdictions: [{ label: 'Ship taxed', rateBasisPoints: 1000, appliesToShipping: true }],
    });

    expect(totals.taxCents).toBe(1100); // 10% of goods + shipping
  });

  it('rounds each jurisdiction separately, as they are actually assessed', () => {
    // State 6.25% + county 2.00% on $19.99.
    // Separately: 125 + 40 = 165. Combined-then-rounded would give 164.
    const totals = computeTotals({
      lines: [line(1999)],
      shippingCents: 0,
      taxJurisdictions: [
        { label: 'State', rateBasisPoints: 625, appliesToShipping: false },
        { label: 'County', rateBasisPoints: 200, appliesToShipping: false },
      ],
    });

    expect(totals.taxBreakdown.map((entry) => entry.amountCents)).toEqual([125, 40]);
    expect(totals.taxCents).toBe(165);
  });

  it('zeroes shipping for a free-shipping coupon without touching the taxable base', () => {
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 1500,
      discount: { kind: 'FREE_SHIPPING', value: 0 },
      taxJurisdictions: [{ label: 'State', rateBasisPoints: 1000, appliesToShipping: true }],
    });

    expect(totals.shippingCents).toBe(0);
    expect(totals.discountCents).toBe(0);
    // Tax is on $100 of goods; the waived shipping contributes nothing.
    expect(totals.taxCents).toBe(1000);
    expect(totals.totalCents).toBe(11_000);
  });

  it('always satisfies the orders_total_is_sum database constraint', () => {
    const totals = computeTotals({
      lines: [line(3499, 3), line(1299, 2)],
      shippingCents: 899,
      discount: { kind: 'PERCENTAGE', value: 12, maxDiscountCents: 1500 },
      taxJurisdictions: [
        { label: 'State', rateBasisPoints: 625, appliesToShipping: true },
        { label: 'County', rateBasisPoints: 150, appliesToShipping: false },
      ],
    });

    expect(totals.totalCents).toBe(
      totals.subtotalCents - totals.discountCents + totals.shippingCents + totals.taxCents,
    );
    expect(totals.discountCents).toBeLessThanOrEqual(totals.subtotalCents);
  });

  it('drops zero-value tax lines rather than listing them', () => {
    const totals = computeTotals({
      lines: [line(1000)],
      shippingCents: 0,
      taxJurisdictions: [{ label: 'Exempt', rateBasisPoints: 0, appliesToShipping: false }],
    });

    expect(totals.taxBreakdown).toEqual([]);
    expect(totals.taxCents).toBe(0);
  });

  it('accumulates weight for weight-based shipping', () => {
    const totals = computeTotals({
      lines: [line(1000, 2, 250), line(2000, 1, 500)],
      shippingCents: 0,
    });

    expect(totals.totalWeightGrams).toBe(1000);
  });

  it('uses provider tax lines verbatim, without re-deriving them', () => {
    // A provider's amount is what gets remitted. Recomputing it from the rate
    // would introduce a discrepancy between the receipt and the filing.
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 599,
      taxLines: [
        { label: 'CA state tax', rateBasisPoints: 625, amountCents: 623 },
        { label: 'LA county tax', rateBasisPoints: 200, amountCents: 202 },
      ],
    });

    // 623 + 202, not the 625 + 200 our own rate arithmetic would produce.
    expect(totals.taxCents).toBe(825);
    expect(totals.totalCents).toBe(10_000 + 599 + 825);
  });

  it('ignores taxJurisdictions when provider lines are supplied', () => {
    const totals = computeTotals({
      lines: [line(10_000)],
      shippingCents: 0,
      taxJurisdictions: [{ label: 'Table', rateBasisPoints: 1000, appliesToShipping: false }],
      taxLines: [{ label: 'Provider', rateBasisPoints: 625, amountCents: 625 }],
    });

    expect(totals.taxCents).toBe(625);
    expect(totals.taxBreakdown).toHaveLength(1);
    expect(totals.taxBreakdown[0]?.label).toBe('Provider');
  });

  it('treats an empty provider line list as no tax', () => {
    // What a no-nexus answer looks like: authoritative zero, not a missing quote.
    const totals = computeTotals({ lines: [line(10_000)], shippingCents: 0, taxLines: [] });

    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(10_000);
  });

  it('never produces a negative shipping charge', () => {
    const totals = computeTotals({ lines: [line(1000)], shippingCents: -500 });
    expect(totals.shippingCents).toBe(0);
  });
});

describe('assertChargeable', () => {
  const base = computeTotals({ lines: [line(1000)], shippingCents: 0 });

  it('accepts a normal total', () => {
    expect(() => assertChargeable(base)).not.toThrow();
  });

  it('refuses a zero total', () => {
    expect(() => assertChargeable({ ...base, totalCents: 0 })).toThrow(/non-positive/);
  });

  it('refuses a negative total', () => {
    expect(() => assertChargeable({ ...base, totalCents: -100 })).toThrow(/non-positive/);
  });

  it('refuses a fractional total', () => {
    expect(() => assertChargeable({ ...base, totalCents: 10.5 })).toThrow(/integer/);
  });

  it('refuses an implausibly large total', () => {
    expect(() => assertChargeable({ ...base, totalCents: 100_000_000 })).toThrow(/maximum/);
  });
});
