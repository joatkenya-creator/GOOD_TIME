'use client';

import { Check, Heart, Link2, Minus, Plus, Scale } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/price';
import { useToast } from '@/components/ui/toast';
import {
  STOCK_LABELS,
  availableQuantity,
  resolvePrice,
  stockStatus,
} from '@/features/catalog/pricing';
import { setCartCount } from '@/hooks/use-cart-count';
import { useCompare, useWishlist } from '@/hooks/use-product-lists';
import { addToCartAction } from '@/server/actions/cart';
import { cn } from '@/utils/cn';

interface OptionValue {
  id: string;
  value: string;
}

interface VariantInput {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  salePriceCents: number | null;
  compareAtPriceCents: number | null;
  valueIds: string[];
  isActive: boolean;
  inventory: {
    quantity: number;
    reserved: number;
    lowStockThreshold: number;
    policy: 'DENY' | 'CONTINUE';
  } | null;
  insertableLengthMm: number | null;
  diameterMm: number | null;
  weightGrams: number | null;
}

export interface ProductPurchasePanelProps {
  productId: string;
  productName: string;
  currency: string;
  options: { id: string; name: string; values: OptionValue[] }[];
  variants: VariantInput[];
}

/**
 * Variant selection, price, stock and save actions.
 *
 * The one client island on the product page. Price and availability re-render
 * from the selected variant, so the figure on screen always belongs to the thing
 * the customer has actually chosen — showing a "from" price next to an
 * out-of-stock variant is how support tickets start.
 *
 * Add-to-cart posts the *variant* id, never the product id — the price, the
 * stock and the SKU all belong to the variant, and adding "the product" is
 * ambiguous the moment there is more than one size.
 */
export function ProductPurchasePanel({
  productId,
  productName,
  currency,
  options,
  variants,
}: ProductPurchasePanelProps) {
  const sellable = variants.filter((variant) => variant.isActive);

  const [selectedValueIds, setSelectedValueIds] = useState<string[]>(
    // Default to the first sellable variant's combination, not to nothing — an
    // unselected state means the price and stock have nothing to describe.
    () => sellable[0]?.valueIds ?? [],
  );
  const [quantity, setQuantity] = useState(1);
  const [adding, startAdding] = useTransition();

  const wishlist = useWishlist();
  const compare = useCompare();
  const { toast } = useToast();

  const selected =
    sellable.find(
      (variant) =>
        variant.valueIds.length === selectedValueIds.length &&
        variant.valueIds.every((id) => selectedValueIds.includes(id)),
    ) ?? sellable[0];

  const price = selected
    ? resolvePrice(selected)
    : {
        effectiveCents: 0,
        compareAtCents: null,
        isOnSale: false,
        discountPercent: 0,
        savingCents: 0,
      };

  const stock = stockStatus(selected?.inventory ?? null);
  const available = availableQuantity(selected?.inventory ?? null);
  const stockLabel = STOCK_LABELS[stock];
  const purchasable = stock !== 'OUT_OF_STOCK';
  const maxQuantity = Math.max(1, Math.min(available || 1, 10));

  function addToBag() {
    if (!selected) return;

    startAdding(async () => {
      const result = await addToCartAction(selected.id, quantity);
      if (result.count !== undefined) setCartCount(result.count);

      toast({
        variant: result.ok ? 'success' : 'error',
        title: result.message,
        description: result.ok ? `${productName} — ${selected.name}` : undefined,
      });
    });
  }

  /** Swaps one axis of the selection, keeping the others. */
  function selectValue(optionValues: OptionValue[], valueId: string) {
    setSelectedValueIds((current) => [
      ...current.filter((id) => !optionValues.some((value) => value.id === id)),
      valueId,
    ]);
    setQuantity(1);
  }

  /**
   * True when picking this value leads to a combination no active variant has —
   * the option is shown struck through rather than hidden, so the customer can
   * see the variant exists but is unavailable.
   */
  function isCombinationAvailable(optionValues: OptionValue[], valueId: string): boolean {
    const candidate = [
      ...selectedValueIds.filter((id) => !optionValues.some((v) => v.id === id)),
      valueId,
    ];

    return sellable.some((variant) => candidate.every((id) => variant.valueIds.includes(id)));
  }

  async function share() {
    const url = window.location.href;

    // `navigator.share` on mobile, clipboard everywhere else. Both are wrapped
    // because a user cancelling the share sheet throws.
    try {
      if (navigator.share) {
        await navigator.share({ title: productName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ variant: 'success', title: 'Link copied' });
    } catch {
      // Cancelled or unsupported — nothing to report.
    }
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <Price
          cents={price.effectiveCents}
          compareAtCents={price.compareAtCents}
          currency={currency}
          size="lg"
        />
        {price.discountPercent > 0 ? (
          <Badge variant="danger" uppercase>
            Save {price.discountPercent}%
          </Badge>
        ) : null}
      </div>

      <p
        aria-live="polite"
        className={cn(
          'mt-2.5 flex items-center gap-2 text-body-sm font-medium',
          stockLabel.tone === 'success' && 'text-success-700',
          stockLabel.tone === 'warning' && 'text-warning-700',
          stockLabel.tone === 'danger' && 'text-danger-700',
          stockLabel.tone === 'neutral' && 'text-foreground-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            stockLabel.tone === 'success' && 'bg-success-500',
            stockLabel.tone === 'warning' && 'bg-warning-500',
            stockLabel.tone === 'danger' && 'bg-danger-500',
            stockLabel.tone === 'neutral' && 'bg-ink-400',
          )}
        />
        {stockLabel.label}
        {stock === 'LOW_STOCK' ? ` — only ${available} left` : ''}
      </p>

      {/* --- Variant options ---------------------------------------- */}
      {options.map((option) => (
        <fieldset key={option.id} className="mt-7">
          <legend className="text-body-sm font-medium text-foreground">
            {option.name}
            <span className="ml-2 font-normal text-foreground-muted">
              {option.values.find((value) => selectedValueIds.includes(value.id))?.value ?? ''}
            </span>
          </legend>

          <div className="mt-3 flex flex-wrap gap-2">
            {option.values.map((value) => {
              const checked = selectedValueIds.includes(value.id);
              const availableCombo = isCombinationAvailable(option.values, value.id);

              return (
                <label
                  key={value.id}
                  className={cn(
                    'cursor-pointer rounded-lg border px-4 py-2.5 text-body-sm transition-colors duration-(--duration-fast)',
                    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--color-ring)',
                    checked
                      ? 'border-foreground bg-foreground text-white'
                      : 'border-border text-foreground hover:border-border-strong',
                    !availableCombo && !checked && 'text-foreground-subtle line-through',
                  )}
                >
                  <input
                    type="radio"
                    name={option.id}
                    className="sr-only"
                    checked={checked}
                    onChange={() => selectValue(option.values, value.id)}
                  />
                  {value.value}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {/* --- Selected variant specifications ------------------------ */}
      {selected && (selected.insertableLengthMm || selected.diameterMm) ? (
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-surface-muted p-4 text-body-sm">
          {selected.insertableLengthMm ? (
            <div>
              <dt className="text-foreground-muted">Insertable length</dt>
              <dd className="font-medium text-foreground">{selected.insertableLengthMm} mm</dd>
            </div>
          ) : null}
          {selected.diameterMm ? (
            <div>
              <dt className="text-foreground-muted">Maximum diameter</dt>
              <dd className="font-medium text-foreground">{selected.diameterMm} mm</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-foreground-muted">SKU</dt>
            <dd className="font-mono text-xs text-foreground">{selected.sku}</dd>
          </div>
        </dl>
      ) : null}

      {/* --- Quantity and actions ----------------------------------- */}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg border border-border">
          <QuantityButton
            label="Decrease quantity"
            disabled={quantity <= 1}
            onClick={() => setQuantity((value) => Math.max(1, value - 1))}
          >
            <Minus aria-hidden="true" className="size-4" />
          </QuantityButton>

          <span aria-live="polite" className="w-10 text-center text-body-sm font-medium">
            {quantity}
            <span className="sr-only"> items selected</span>
          </span>

          <QuantityButton
            label="Increase quantity"
            disabled={quantity >= maxQuantity}
            onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
          >
            <Plus aria-hidden="true" className="size-4" />
          </QuantityButton>
        </div>

        <Button
          size="lg"
          className="flex-1"
          disabled={!purchasable}
          isLoading={adding}
          onClick={addToBag}
        >
          {purchasable ? 'Add to bag' : 'Out of stock'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const added = wishlist.toggle(productId);
            toast({
              variant: 'success',
              title: added ? 'Saved to wishlist' : 'Removed from wishlist',
            });
          }}
          aria-pressed={wishlist.has(productId)}
        >
          <Heart className={cn(wishlist.has(productId) && 'fill-accent text-accent')} />
          {wishlist.has(productId) ? 'Saved' : 'Save'}
        </Button>

        <Button
          variant="outline"
          onClick={() => {
            if (compare.has(productId)) {
              compare.remove(productId);
              return;
            }
            const result = compare.tryAdd(productId);
            if (!result.ok && result.reason === 'full') {
              toast({
                variant: 'warning',
                title: `Compare holds ${compare.limit} products`,
                description: 'Remove one to add another.',
              });
            }
          }}
          aria-pressed={compare.has(productId)}
        >
          {compare.has(productId) ? <Check /> : <Scale />}
          Compare
        </Button>

        <Button variant="outline" onClick={share}>
          <Link2 />
          Share
        </Button>
      </div>
    </div>
  );
}

function QuantityButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring) disabled:opacity-40"
    >
      {children}
    </button>
  );
}
