import { beforeEach, describe, expect, it, vi } from 'vitest';

import { anOrder, anOrderItem, resetFixtureSequence } from './fixtures';

/**
 * The Klarna order lines.
 *
 * Klarna rejects a session whose lines do not sum to `order_amount`, and it
 * renders these verbatim to the customer in its widget and in their Klarna app.
 * So this function has two jobs — arithmetic that Klarna will accept, and text
 * a buyer will recognise as the order they just reviewed — and getting either
 * wrong breaks checkout for everyone rather than for an edge case.
 */

// `buildOrderLines` is pure, but its module imports the Prisma client at load.
async function loadBuilder() {
  vi.resetModules();
  const payments = await import('@/services/payment.service');
  return payments.buildOrderLines;
}

/** What Klarna validates: every line's `total_amount` against `order_amount`. */
function sumOf(lines: { total_amount: number }[]): number {
  return lines.reduce((total, line) => total + line.total_amount, 0);
}

beforeEach(() => {
  resetFixtureSequence();
});

describe('buildOrderLines', () => {
  it('sums exactly to what Klarna is being asked to fund', async () => {
    const build = await loadBuilder();
    const order = anOrder();

    const lines = build(order as never);

    expect(sumOf(lines)).toBe(order.totalCents - order.creditAppliedCents);
  });

  it('still sums exactly when a percentage discount rounds badly', async () => {
    const build = await loadBuilder();

    /*
     * Three items at 3333 with a 33% discount is 3299.67 — the case that
     * produces a residual cent no matter which way it is rounded. Klarna
     * refuses the entire session over that cent, so the adjustment line exists
     * to keep a real basket payable.
     */
    const order = anOrder({
      items: [anOrderItem({ quantity: 3, unitPriceCents: 3333, discountCents: 3300 })],
    });

    const lines = build(order as never);

    expect(sumOf(lines)).toBe(order.totalCents - order.creditAppliedCents);
  });

  it('presents store credit as a negative line so the totals reconcile', async () => {
    const build = await loadBuilder();
    const order = anOrder({ creditAppliedCents: 2500 });

    const lines = build(order as never);
    const credit = lines.find((line) => line.name === 'Store credit and rewards');

    expect(credit).toBeDefined();
    expect(credit!.total_amount).toBe(-2500);
    // Klarna funds the remainder, never the whole order — charging it the full
    // total would take the loyalty tender twice.
    expect(sumOf(lines)).toBe(order.totalCents - 2500);
  });

  it('declares shipping and tax as their own typed lines', async () => {
    const build = await loadBuilder();
    const order = anOrder();

    const lines = build(order as never);

    // Klarna uses the line `type` for its own reporting and for what the
    // customer sees. A shipping fee folded into an item is a support ticket.
    expect(lines.find((line) => line.type === 'shipping_fee')?.total_amount).toBe(
      order.shippingCents,
    );
    expect(lines.find((line) => line.type === 'sales_tax')?.total_amount).toBe(order.taxCents);
  });

  it('omits shipping and tax lines when they are zero', async () => {
    const build = await loadBuilder();
    const order = anOrder({ shippingCents: 0, taxCents: 0 });

    const lines = build(order as never);

    // A "Shipping: $0.00" line in the Klarna app reads as a mistake.
    expect(lines.some((line) => line.type === 'shipping_fee')).toBe(false);
    expect(lines.some((line) => line.type === 'sales_tax')).toBe(false);
  });

  it('carries the SKU as the Klarna reference', async () => {
    const build = await loadBuilder();
    const order = anOrder();

    const lines = build(order as never);
    const physical = lines.filter((line) => line.type === 'physical');

    // This is what makes a Klarna dispute traceable back to a specific unit.
    expect(physical[0]!.reference).toBe(order.items[0]!.sku);
  });

  it('names a variant distinctly, but does not repeat itself', async () => {
    const build = await loadBuilder();

    const distinct = anOrder({
      items: [anOrderItem({ productName: 'Lumen Chemise', variantName: 'Rose / M' })],
    });
    const same = anOrder({
      items: [anOrderItem({ productName: 'Gift Card', variantName: 'Gift Card' })],
    });

    expect(build(distinct as never)[0]!.name).toBe('Lumen Chemise — Rose / M');
    // "Gift Card — Gift Card" is the kind of detail a customer screenshots.
    expect(build(same as never)[0]!.name).toBe('Gift Card');
  });

  it('handles a multi-line basket without drifting', async () => {
    const build = await loadBuilder();

    const order = anOrder({
      items: [
        anOrderItem({ quantity: 1, unitPriceCents: 1299, discountCents: 0 }),
        anOrderItem({ quantity: 3, unitPriceCents: 899, discountCents: 269 }),
        anOrderItem({ quantity: 2, unitPriceCents: 15_999, discountCents: 4800 }),
      ],
      creditAppliedCents: 1000,
    });

    const lines = build(order as never);

    expect(sumOf(lines)).toBe(order.totalCents - 1000);
    expect(lines.filter((line) => line.type === 'physical')).toHaveLength(3);
  });
});
