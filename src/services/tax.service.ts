import 'server-only';

import { computeTotals, type TaxJurisdiction } from '@/features/checkout/totals';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import * as taxjar from '@/services/tax/taxjar';
import type { TaxAddress, TaxQuote, TaxQuoteInput } from '@/services/tax/types';

export type { TaxAddress, TaxQuote, TaxQuoteInput } from '@/services/tax/types';

/**
 * US sales tax.
 *
 * `quoteTax` is the only function anything outside this module should call. It
 * picks a provider, and everything downstream consumes a `TaxQuote` without
 * knowing whether the number came from a lookup table or from TaxJar.
 *
 * ## Two implementations
 *
 * **TaxJar**, when `TAXJAR_API_KEY` and a ship-from address are configured. It
 * knows the ~11,000 real jurisdictions, which of them tax shipping, and whether
 * we have nexus at all — the last of which a rate table cannot express even in
 * principle.
 *
 * **The seeded table** otherwise. Combined state-level averages: close enough to
 * show a plausible number in a cart, and nowhere near close enough to file a
 * return on.
 *
 * ## When the provider fails
 *
 * The table stands in and the quote is marked `degraded`. This is fail-*open*,
 * and it is a deliberate trade: a tax provider having a bad afternoon should not
 * stop the store taking orders. The order records `taxSource`, so every order
 * priced from the estimate during an outage can be found and reconciled
 * afterwards — which is the part that makes fail-open defensible rather than
 * merely convenient.
 */

/**
 * Quotes tax for an order.
 *
 * Call it with the base *after* discount — tax is charged on what the customer
 * actually pays. `shippingCents` is passed separately because whether shipping is
 * taxable is the destination's decision, not ours.
 */
export async function quoteTax(input: TaxQuoteInput): Promise<TaxQuote> {
  if (!input.address.state) {
    return { lines: [], totalCents: 0, source: 'none' };
  }

  if (env.TAX_PROVIDER === 'taxjar' && taxjar.isConfigured()) {
    try {
      return await taxjar.quote(input);
    } catch (error) {
      // Loud: every order priced through this branch is charging an estimate
      // rather than an assessed amount.
      logger.error('tax.provider_failed', error, {
        provider: 'taxjar',
        state: input.address.state,
      });
      return { ...(await quoteFromTable(input)), degraded: true };
    }
  }

  return quoteFromTable(input);
}

/**
 * The table implementation, expressed as a provider.
 *
 * Reuses `computeTotals` rather than re-deriving the per-jurisdiction arithmetic,
 * so the estimate and the real thing round identically.
 */
async function quoteFromTable(input: TaxQuoteInput): Promise<TaxQuote> {
  const jurisdictions = await resolveJurisdictions(input.address);
  if (jurisdictions.length === 0) {
    return { lines: [], totalCents: 0, source: 'none' };
  }

  const totals = computeTotals({
    lines: [{ unitPriceCents: input.taxableGoodsCents, quantity: 1 }],
    shippingCents: input.shippingCents,
    taxJurisdictions: jurisdictions,
  });

  return { lines: totals.taxBreakdown, totalCents: totals.taxCents, source: 'table' };
}

/**
 * Rates that apply to a destination, most specific first.
 *
 * Every matching row is returned, not just the best one: US tax is genuinely
 * cumulative — a California address owes state *and* county *and* district — so
 * the caller sums them rather than picking one.
 *
 * A destination with no rows returns an empty array, which
 * `computeTotals` treats as "no tax charged". That is correct for the 5 states
 * with no sales tax and for anywhere we have not configured yet; the difference
 * matters and is why this returns `[]` rather than a zero rate.
 */
export async function resolveJurisdictions(address: TaxAddress): Promise<TaxJurisdiction[]> {
  if (!address.state) return [];

  const country = address.country ?? 'US';

  const rows = await prisma.taxRate.findMany({
    where: {
      isActive: true,
      country,
      state: address.state.toUpperCase(),
      // A row with a null county/postal applies to the whole state; a row with a
      // value applies only to that county/postal. Both are collected.
      AND: [
        { OR: [{ county: null }, ...(address.county ? [{ county: address.county }] : [])] },
        {
          OR: [
            { postalCode: null },
            ...(address.postalCode ? [{ postalCode: address.postalCode }] : []),
          ],
        },
      ],
    },
    orderBy: [{ postalCode: 'desc' }, { county: 'desc' }, { rateBasisPoints: 'desc' }],
  });

  return rows.map((row) => ({
    label: row.label,
    rateBasisPoints: row.rateBasisPoints,
    appliesToShipping: row.appliesToShipping,
  }));
}

/** True when we have any rate configured for a state — drives the UI's honesty. */
export async function hasRatesFor(state: string): Promise<boolean> {
  const count = await prisma.taxRate.count({
    where: { isActive: true, state: state.toUpperCase() },
  });
  return count > 0;
}

/**
 * Combined rate as a percentage, for display only.
 *
 * Never use this to compute a charge: summing rates and rounding once produces a
 * different figure from rounding each jurisdiction separately, which is how tax
 * is actually assessed. `computeTotals` does it correctly.
 */
export function combinedRatePercent(jurisdictions: TaxJurisdiction[]): number {
  const basisPoints = jurisdictions.reduce((sum, entry) => sum + entry.rateBasisPoints, 0);
  return basisPoints / 100;
}
