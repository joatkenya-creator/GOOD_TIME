/**
 * Order totals.
 *
 * Pure functions over integer cents. No database, no I/O, no dates — so the
 * arithmetic that decides what a customer is charged is exhaustively testable
 * and identical in the cart, at checkout, on the payment intent and on the
 * receipt. Four implementations of "what does this cost" is how a storefront
 * ends up displaying one number and charging another.
 *
 * ## Rules encoded here
 *
 *   1. **Order of operations is fixed**: discount applies to the subtotal, then
 *      shipping is added, then tax is computed on whatever the jurisdiction taxes.
 *      Applying a discount after tax over-refunds; taxing before discount
 *      over-charges. Both are the kind of error that shows up in an audit.
 *   2. **A discount never exceeds the subtotal.** A $50 coupon on a $30 order is
 *      a $30 discount, not a $20 payout.
 *   3. **Rounding happens once, at the end of each component**, using
 *      round-half-up on the cent. Rounding each line item independently drifts.
 *   4. **Free shipping is a shipping discount, not a subtotal discount** — it
 *      must not reduce the taxable base.
 */

export interface TotalsLine {
  /** Effective unit price in cents, already resolved from sale/list. */
  unitPriceCents: number;
  quantity: number;
  /** Grams per unit, for weight-based shipping. */
  weightGrams?: number;
}

export type DiscountKind = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

export interface DiscountInput {
  kind: DiscountKind;
  /** Percentage points for PERCENTAGE, cents for FIXED_AMOUNT, unused otherwise. */
  value: number;
  /** Caps a percentage discount. Null means uncapped. */
  maxDiscountCents?: number | null;
}

export interface TaxJurisdiction {
  label: string;
  /** Basis points: 825 = 8.25%. Integers only, never a float rate. */
  rateBasisPoints: number;
  appliesToShipping: boolean;
}

export interface TotalsInput {
  lines: TotalsLine[];
  shippingCents: number;
  discount?: DiscountInput | null;
  /** Empty means no tax is charged — an unknown destination, not a zero rate. */
  taxJurisdictions?: TaxJurisdiction[];
  /**
   * Tax already computed by an external authority, used verbatim.
   *
   * A rate table lets us derive amounts; a tax provider hands back *amounts*,
   * and its figure — not our re-derivation of it — is what gets filed. When this
   * is present `taxJurisdictions` is ignored.
   *
   * The two-pass shape this implies is deliberate: call `computeTotals` once
   * without tax to learn the discounted base, quote the provider against that,
   * then call it again with the answer. The arithmetic stays in one place.
   */
  taxLines?: TaxLine[];
}

export interface TaxLine {
  label: string;
  rateBasisPoints: number;
  amountCents: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** Per-jurisdiction split, snapshotted onto the order. */
  taxBreakdown: TaxLine[];
  totalWeightGrams: number;
  itemCount: number;
}

/**
 * Round half up on the cent.
 *
 * `Math.round` rounds -0.5 towards zero, which silently loses a cent on refunds
 * and credits. Every monetary rounding in the codebase goes through here.
 */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function lineTotalCents(line: TotalsLine): number {
  return line.unitPriceCents * line.quantity;
}

export function subtotalOf(lines: TotalsLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

export function totalWeightOf(lines: TotalsLine[]): number {
  return lines.reduce((sum, line) => sum + (line.weightGrams ?? 0) * line.quantity, 0);
}

/**
 * Discount amount against a subtotal.
 *
 * Returns cents off the *subtotal*. `FREE_SHIPPING` returns zero here by design —
 * it is applied to the shipping component so the taxable base is unaffected.
 */
export function discountAmountCents(
  subtotalCents: number,
  discount?: DiscountInput | null,
): number {
  if (!discount || subtotalCents <= 0) return 0;

  let amount = 0;

  if (discount.kind === 'PERCENTAGE') {
    amount = roundCents((subtotalCents * discount.value) / 100);
  } else if (discount.kind === 'FIXED_AMOUNT') {
    amount = discount.value;
  } else {
    return 0; // FREE_SHIPPING never reduces the subtotal.
  }

  if (discount.maxDiscountCents != null) amount = Math.min(amount, discount.maxDiscountCents);

  // Never discount more than there is to discount.
  return Math.max(0, Math.min(amount, subtotalCents));
}

/**
 * Computes every figure on an order.
 *
 * Tax is charged on the discounted subtotal, plus shipping only where the
 * jurisdiction taxes shipping. Each jurisdiction is rounded independently and
 * then summed, which is how a combined state + county rate is actually assessed —
 * summing the rates first and rounding once produces a different, wrong number.
 */
export function computeTotals(input: TotalsInput): Totals {
  const subtotalCents = subtotalOf(input.lines);
  const freeShipping = input.discount?.kind === 'FREE_SHIPPING';

  const discountCents = discountAmountCents(subtotalCents, input.discount);
  const shippingCents = freeShipping ? 0 : Math.max(0, input.shippingCents);

  const taxableGoods = Math.max(0, subtotalCents - discountCents);

  // Provider amounts win over our own rate arithmetic — they are the figure that
  // gets remitted, and recomputing them would only introduce a discrepancy.
  const taxBreakdown: TaxLine[] = input.taxLines
    ? input.taxLines.filter((line) => line.amountCents > 0)
    : (input.taxJurisdictions ?? [])
        .map((jurisdiction) => {
          const base = taxableGoods + (jurisdiction.appliesToShipping ? shippingCents : 0);
          return {
            label: jurisdiction.label,
            rateBasisPoints: jurisdiction.rateBasisPoints,
            amountCents: roundCents((base * jurisdiction.rateBasisPoints) / 10_000),
          };
        })
        .filter((line) => line.amountCents > 0);

  const taxCents = taxBreakdown.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    // Matches the `orders_total_is_sum` check constraint exactly.
    totalCents: subtotalCents - discountCents + shippingCents + taxCents,
    taxBreakdown,
    totalWeightGrams: totalWeightOf(input.lines),
    itemCount: input.lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

/**
 * Guards the amount handed to the payment provider.
 *
 * The charge is computed server-side from the cart, never sent by the client —
 * but this is the last checkable assertion before money moves, and it is cheap.
 */
export function assertChargeable(totals: Totals): void {
  if (!Number.isInteger(totals.totalCents)) {
    throw new Error(`Total must be an integer number of cents, got ${totals.totalCents}`);
  }
  if (totals.totalCents <= 0) {
    throw new Error(`Refusing to charge a non-positive total (${totals.totalCents}c)`);
  }
  // A sanity ceiling for a single order in USD. Klarna underwrites per
  // customer rather than per transaction, so this is our limit, not theirs:
  // an order past it is far more likely to be a bug than a real basket.
  if (totals.totalCents > 99_999_999) {
    throw new Error(`Total ${totals.totalCents}c exceeds the maximum single charge`);
  }
}
