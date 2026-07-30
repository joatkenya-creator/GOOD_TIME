import { siteConfig } from '@/config/site';

/**
 * Formatters are memoised because `Intl.*` constructors are expensive and product
 * grids call them hundreds of times per render.
 */
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(siteConfig.locale, {
      style: 'currency',
      currency,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter;
}

/** Money is stored and passed around as integer cents. Convert only at the edge. */
export function formatPrice(cents: number, currency: string = siteConfig.currency): string {
  return currencyFormatter(currency).format(cents / 100);
}

export function formatPriceRange(
  minCents: number,
  maxCents: number,
  currency: string = siteConfig.currency,
): string {
  return minCents === maxCents
    ? formatPrice(minCents, currency)
    : `${formatPrice(minCents, currency)} – ${formatPrice(maxCents, currency)}`;
}

const dateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDate(value: Date | string): string {
  return dateFormatter.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(typeof value === 'string' ? new Date(value) : value);
}

const compactFormatter = new Intl.NumberFormat(siteConfig.locale, { notation: 'compact' });

/** 1234 -> "1.2K". Used for review counts and stock badges. */
export function formatCompactNumber(value: number): string {
  return compactFormatter.format(value);
}

export function formatPercentage(fraction: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(siteConfig.locale, {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
  }).format(fraction);
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
