import type { TaxLine } from '@/features/checkout/totals';

/**
 * The tax seam.
 *
 * Two implementations exist — the seeded rate table and TaxJar — and a third
 * (Avalara) would only need to satisfy `quote(input): Promise<TaxQuote>`.
 * Everything upstream consumes `TaxQuote` and knows nothing about where the
 * number came from.
 */

export interface TaxAddress {
  country?: string;
  state?: string | null;
  city?: string | null;
  county?: string | null;
  postalCode?: string | null;
  line1?: string | null;
}

export interface TaxQuoteLine {
  unitPriceCents: number;
  quantity: number;
  /**
   * Provider taxability category.
   *
   * Not every product is taxed at the standard rate, and the categories are
   * provider-specific. Unset means "general merchandise", which is correct for
   * everything this store sells today.
   */
  productTaxCode?: string | null;
}

export interface TaxQuoteInput {
  address: TaxAddress;
  /**
   * Goods after any discount. Tax is charged on what the customer actually pays,
   * so the caller must have applied the discount before quoting.
   */
  taxableGoodsCents: number;
  /** Passed separately: whether shipping is taxable is the destination's call. */
  shippingCents: number;
  lines: TaxQuoteLine[];
}

export interface TaxQuote {
  /** Per-jurisdiction split, snapshotted onto the order. */
  lines: TaxLine[];
  totalCents: number;
  /**
   * Where the number came from. Recorded on the order, because "why was I
   * charged this" is unanswerable without it — and because an order priced from
   * the estimate during a provider outage needs to be findable afterwards.
   */
  source: 'provider' | 'table' | 'none';
  provider?: string;
  /** False means the provider says we are not registered to collect here. */
  hasNexus?: boolean;
  freightTaxable?: boolean;
  /** Set when a provider was configured but failed and the table stood in. */
  degraded?: boolean;
}
