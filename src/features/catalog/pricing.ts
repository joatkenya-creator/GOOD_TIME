/**
 * Price resolution.
 *
 * A variant carries three prices and the storefront must never guess which one
 * applies. Every read goes through here so the rule lives in exactly one place —
 * a second implementation is how a sale price ends up shown on the listing but
 * charged at list price in the cart.
 */

export interface VariantPricing {
  priceCents: number;
  salePriceCents?: number | null;
  compareAtPriceCents?: number | null;
}

export interface ResolvedPrice {
  /** What the customer pays. */
  effectiveCents: number;
  /** Strike-through value, or null when there is nothing to strike through. */
  compareAtCents: number | null;
  isOnSale: boolean;
  /** Whole percent saved against `compareAtCents`. 0 when not on sale. */
  discountPercent: number;
  savingCents: number;
}

export function effectivePriceCents(variant: VariantPricing): number {
  return variant.salePriceCents ?? variant.priceCents;
}

export function resolvePrice(variant: VariantPricing): ResolvedPrice {
  const effectiveCents = effectivePriceCents(variant);

  // Prefer the explicit MSRP anchor; fall back to list price when a sale is on.
  // Only treat it as a comparison if it is genuinely higher — a "was" price equal
  // to or below the current price is a data error, not a discount.
  const candidate = variant.compareAtPriceCents ?? variant.priceCents;
  const compareAtCents = candidate > effectiveCents ? candidate : null;

  const savingCents = compareAtCents ? compareAtCents - effectiveCents : 0;

  return {
    effectiveCents,
    compareAtCents,
    isOnSale: savingCents > 0,
    discountPercent: compareAtCents ? Math.round((savingCents / compareAtCents) * 100) : 0,
    savingCents,
  };
}

/**
 * Collapses a variant set into the denormalised range stored on `Product`.
 *
 * Inactive and soft-deleted variants are excluded: a listing must not advertise
 * a price the customer cannot actually buy.
 */
export function priceRange(variants: (VariantPricing & { isActive?: boolean })[]): {
  minPriceCents: number;
  maxPriceCents: number;
  isOnSale: boolean;
} {
  const sellable = variants.filter((variant) => variant.isActive !== false);
  if (!sellable.length) return { minPriceCents: 0, maxPriceCents: 0, isOnSale: false };

  const prices = sellable.map(effectivePriceCents);

  return {
    minPriceCents: Math.min(...prices),
    maxPriceCents: Math.max(...prices),
    isOnSale: sellable.some((variant) => resolvePrice(variant).isOnSale),
  };
}

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'BACKORDER';

export interface StockInput {
  quantity: number;
  reserved: number;
  lowStockThreshold: number;
  /** `CONTINUE` allows selling past zero. */
  policy: 'DENY' | 'CONTINUE';
}

/**
 * Derived stock status.
 *
 * Available stock is `quantity - reserved`, never the raw quantity — units held
 * by an in-flight checkout are already spoken for, and showing them is how two
 * customers buy the last item.
 */
export function stockStatus(inventory: StockInput | null | undefined): StockStatus {
  if (!inventory) return 'OUT_OF_STOCK';

  const available = inventory.quantity - inventory.reserved;

  if (available > inventory.lowStockThreshold) return 'IN_STOCK';
  if (available > 0) return 'LOW_STOCK';
  return inventory.policy === 'CONTINUE' ? 'BACKORDER' : 'OUT_OF_STOCK';
}

export function availableQuantity(inventory: StockInput | null | undefined): number {
  if (!inventory) return 0;
  return Math.max(0, inventory.quantity - inventory.reserved);
}

/** Maps status to the copy and tone the UI shows. Kept next to the logic. */
export const STOCK_LABELS: Record<
  StockStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  IN_STOCK: { label: 'In stock', tone: 'success' },
  LOW_STOCK: { label: 'Low stock', tone: 'warning' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'danger' },
  BACKORDER: { label: 'On backorder', tone: 'neutral' },
};
