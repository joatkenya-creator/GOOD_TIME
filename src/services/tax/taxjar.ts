import 'server-only';

import { roundCents, type TaxLine } from '@/features/checkout/totals';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import type { TaxQuote, TaxQuoteInput } from '@/services/tax/types';

/**
 * TaxJar.
 *
 * One of the two implementations behind `quoteTax`. TaxJar was chosen over
 * Avalara for a store this size: a single stateless `POST /v2/taxes` returns a
 * full jurisdiction breakdown, where AvaTax wants a company code, a document
 * type and a commit/void lifecycle that only earns its keep once you are filing
 * in dozens of states. The seam is the same either way — an Avalara adapter
 * implements `quoteTax`'s contract and nothing above it changes.
 *
 * ## What this fixes
 *
 * The rate table is combined state-level averages. TaxJar knows the ~11,000 real
 * jurisdictions, which of them tax shipping, and — the part a table fundamentally
 * cannot express — **whether you have nexus at all**. `has_nexus: false` is an
 * authoritative "charge nothing", not a gap in our data.
 *
 * ## Units
 *
 * TaxJar speaks dollars as JSON numbers. Every crossing of this boundary converts
 * to integer cents immediately and never converts back; the request body is the
 * only place a float is allowed to exist.
 */

const ENDPOINT = 'https://api.taxjar.com/v2/taxes';

/**
 * Hard ceiling on the call.
 *
 * Checkout blocks on this. A tax provider having a slow day must not turn into a
 * storefront having a slow day, and 2.5s is already longer than anyone will wait
 * politely.
 */
const TIMEOUT_MS = 2_500;

const dollars = (cents: number): number => Number((cents / 100).toFixed(2));

interface TaxJarBreakdown {
  state_tax_rate?: number;
  state_tax_collectable?: number;
  county_tax_rate?: number;
  county_tax_collectable?: number;
  city_tax_rate?: number;
  city_tax_collectable?: number;
  special_tax_rate?: number;
  special_district_tax_collectable?: number;
}

interface TaxJarResponse {
  tax: {
    amount_to_collect: number;
    rate: number;
    has_nexus: boolean;
    freight_taxable: boolean;
    tax_source?: string;
    jurisdictions?: { state?: string; county?: string; city?: string };
    breakdown?: TaxJarBreakdown;
  };
}

export function isConfigured(): boolean {
  return Boolean(env.TAXJAR_API_KEY && env.SHIP_FROM_ZIP && env.SHIP_FROM_STATE);
}

/**
 * Quotes tax for one order.
 *
 * Throws on any failure — network, timeout, non-2xx, malformed body. The caller
 * (`quoteTax`) decides what to do about it, because "fall back to the table" is a
 * policy decision and does not belong in a transport adapter.
 */
export async function quote(input: TaxQuoteInput): Promise<TaxQuote> {
  if (!env.TAXJAR_API_KEY) throw new Error('TAXJAR_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.TAXJAR_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_country: env.SHIP_FROM_COUNTRY,
        from_zip: env.SHIP_FROM_ZIP,
        from_state: env.SHIP_FROM_STATE,
        from_city: env.SHIP_FROM_CITY,
        from_street: env.SHIP_FROM_STREET,

        to_country: input.address.country ?? 'US',
        to_zip: input.address.postalCode,
        to_state: input.address.state,
        to_city: input.address.city,
        to_street: input.address.line1,

        // Goods only — TaxJar takes shipping separately and decides for itself
        // whether this destination taxes it.
        amount: dollars(input.taxableGoodsCents),
        shipping: dollars(input.shippingCents),

        line_items: input.lines.map((line, index) => ({
          id: String(index),
          quantity: line.quantity,
          unit_price: dollars(line.unitPriceCents),
          ...(line.productTaxCode ? { product_tax_code: line.productTaxCode } : {}),
        })),
      }),
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TaxJar ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as TaxJarResponse;
  const tax = payload.tax;

  if (!tax || typeof tax.amount_to_collect !== 'number') {
    throw new Error('TaxJar returned a body without amount_to_collect');
  }

  // No nexus is a real answer, not a missing one: we are not registered to
  // collect in this state, so the correct amount is zero.
  if (!tax.has_nexus) {
    logger.debug('taxjar.no_nexus', { state: input.address.state });
    return { lines: [], totalCents: 0, source: 'provider', provider: 'taxjar', hasNexus: false };
  }

  const totalCents = roundCents(tax.amount_to_collect * 100);
  const jurisdictions = tax.jurisdictions ?? {};
  const breakdown = tax.breakdown ?? {};

  const lines = reconcile(
    [
      component(
        'State',
        jurisdictions.state,
        breakdown.state_tax_rate,
        breakdown.state_tax_collectable,
      ),
      component(
        'County',
        jurisdictions.county,
        breakdown.county_tax_rate,
        breakdown.county_tax_collectable,
      ),
      component(
        'City',
        jurisdictions.city,
        breakdown.city_tax_rate,
        breakdown.city_tax_collectable,
      ),
      component(
        'Special district',
        undefined,
        breakdown.special_tax_rate,
        breakdown.special_district_tax_collectable,
      ),
    ].filter((line): line is TaxLine => line !== null),
    totalCents,
  );

  return {
    lines,
    totalCents,
    source: 'provider',
    provider: 'taxjar',
    hasNexus: true,
    freightTaxable: tax.freight_taxable,
  };
}

function component(
  kind: string,
  jurisdiction: string | undefined,
  rate: number | undefined,
  collectable: number | undefined,
): TaxLine | null {
  if (!collectable || collectable <= 0) return null;

  return {
    // "CA state tax", falling back to "State tax" when TaxJar omits the name.
    label: jurisdiction ? `${titleCase(jurisdiction)} ${kind.toLowerCase()} tax` : `${kind} tax`,
    rateBasisPoints: Math.round((rate ?? 0) * 10_000),
    amountCents: roundCents(collectable * 100),
  };
}

/**
 * Forces the components to sum to the authoritative total.
 *
 * TaxJar rounds each component and the total independently, so the parts can miss
 * the whole by a cent. The total is what gets charged and remitted, so the
 * remainder is pushed onto the largest component rather than left to make a
 * receipt that does not add up.
 */
function reconcile(lines: TaxLine[], totalCents: number): TaxLine[] {
  if (lines.length === 0) {
    return totalCents > 0
      ? [{ label: 'Sales tax', rateBasisPoints: 0, amountCents: totalCents }]
      : [];
  }

  const sum = lines.reduce((accumulator, line) => accumulator + line.amountCents, 0);
  const drift = totalCents - sum;
  if (drift === 0) return lines;

  let largestIndex = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.amountCents > lines[largestIndex]!.amountCents) largestIndex = index;
  }

  return lines.map((line, index) =>
    index === largestIndex ? { ...line, amountCents: line.amountCents + drift } : line,
  );
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
