import 'server-only';

import type { ShippingRateModel as ShippingRate } from '@/generated/prisma/models';
import { prisma } from '@/lib/prisma';

/**
 * Shipping options and pricing.
 *
 * Rates live in the database so operations can change a price or add "Free over
 * $75" without a deploy. A carrier integration later replaces `priceFor` â€” the
 * function that turns a rate plus a basket into a number â€” and nothing above it
 * changes.
 */

export interface ShippingContext {
  subtotalCents: number;
  totalWeightGrams: number;
  state?: string | null;
  country?: string;
}

export interface ShippingOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  carrier: string;
  /** True when a free-shipping threshold zeroed an otherwise-paid rate. */
  isFreeByThreshold: boolean;
}

/**
 * Price for one rate against one basket.
 *
 * Threshold-based free shipping is applied last, so a weight surcharge cannot
 * survive an order that qualified for free delivery.
 */
export function priceFor(rate: ShippingRate, context: ShippingContext): number {
  if (rate.type === 'FREE') return 0;

  let price = rate.baseCents;

  if (rate.type === 'WEIGHT_BASED') {
    const billableGrams = Math.max(0, context.totalWeightGrams - rate.freeWeightGrams);
    // Charged per started kilogram, which is how carriers actually bill.
    price += Math.ceil(billableGrams / 1000) * rate.perKgCents;
  }

  if (
    rate.freeAboveSubtotalCents != null &&
    context.subtotalCents >= rate.freeAboveSubtotalCents
  ) {
    return 0;
  }

  return Math.max(0, price);
}

/** True when a rate is offered for this basket and destination. */
export function isEligible(rate: ShippingRate, context: ShippingContext): boolean {
  if (!rate.isActive) return false;

  if (rate.minSubtotalCents != null && context.subtotalCents < rate.minSubtotalCents) return false;

  const country = context.country ?? 'US';
  if (rate.countries.length && !rate.countries.includes(country)) return false;

  // Empty `states` means "everywhere we ship"; populated restricts.
  if (rate.states.length) {
    if (!context.state) return false;
    if (!rate.states.includes(context.state.toUpperCase())) return false;
  }

  return true;
}

export async function getShippingOptions(context: ShippingContext): Promise<ShippingOption[]> {
  const rates = await prisma.shippingRate.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
  });

  return rates
    .filter((rate) => isEligible(rate, context))
    .map((rate) => {
      const priceCents = priceFor(rate, context);

      return {
        id: rate.id,
        code: rate.code,
        name: rate.name,
        description: rate.description,
        priceCents,
        estimatedDaysMin: rate.estimatedDaysMin,
        estimatedDaysMax: rate.estimatedDaysMax,
        carrier: rate.carrier,
        isFreeByThreshold: priceCents === 0 && rate.type !== 'FREE',
      };
    });
}

export async function getShippingRate(id: string): Promise<ShippingRate | null> {
  return prisma.shippingRate.findFirst({ where: { id, isActive: true } });
}

/**
 * Cheapest eligible option, used for the pre-address estimate in the cart.
 *
 * The cart shows "estimated shipping" before a destination exists, and quoting
 * the cheapest is the honest default â€” quoting the most expensive suppresses
 * conversion, quoting zero surprises people at checkout.
 */
export async function getCheapestOption(context: ShippingContext): Promise<ShippingOption | null> {
  const options = await getShippingOptions(context);
  if (!options.length) return null;

  return options.reduce((cheapest, option) =>
    option.priceCents < cheapest.priceCents ? option : cheapest,
  );
}

/**
 * Delivery window, counted in business days from today.
 *
 * Weekends are skipped because quoting a Sunday arrival generates a support
 * ticket. Carrier holidays are not modelled â€” that arrives with the carrier
 * integration, which knows its own calendar.
 */
export function estimateDelivery(
  daysMin: number,
  daysMax: number,
  from: Date = new Date(),
): { earliest: Date; latest: Date } {
  return { earliest: addBusinessDays(from, daysMin), latest: addBusinessDays(from, daysMax) };
}

function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from);
  let added = 0;

  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }

  return date;
}
