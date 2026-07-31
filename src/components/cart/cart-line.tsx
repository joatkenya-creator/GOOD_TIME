'use client';

import { BookmarkPlus, Minus, Plus, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/price';
import { useToast } from '@/components/ui/toast';
import { setCartCount } from '@/hooks/use-cart-count';
import type { CartLineView } from '@/services/cart.service';
import {
  removeFromCartAction,
  saveForLaterAction,
  undoRemoveAction,
  updateQuantityAction,
} from '@/server/actions/cart';
import { cn } from '@/utils/cn';

/**
 * One row in the cart.
 *
 * Every control is a real button inside a transition, so the row stays
 * interactive-but-dimmed while the server action runs. Disabling the whole row
 * would make a double-tap on a slow connection feel like the app had frozen.
 */
export function CartLine({
  line,
  compact = false,
}: {
  line: CartLineView;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function setQuantity(next: number) {
    startTransition(async () => {
      const result = await updateQuantityAction(line.id, next);
      if (result.count !== undefined) setCartCount(result.count);
      if (!result.ok) toast({ variant: 'error', title: result.message });
    });
  }

  /**
   * Removes the line and offers an undo.
   *
   * The toast is raised *before* the await, not after. Removing the last item
   * re-renders the cart without this row, so this component unmounts while the
   * action is still in flight — and anything queued after the await never runs.
   * Raising it first also means the confirmation appears on the tap rather than
   * a second later, which is how it should feel regardless.
   *
   * Undo rather than a confirm dialog: removing is cheap to reverse, and a modal
   * on every removal costs far more taps than the occasional mistake.
   */
  function remove() {
    // Snapshotted for the same reason — `line` is gone once the row unmounts.
    const restore = { variantId: line.variantId, quantity: line.quantity };

    // Started here, outside the transition, so the undo handler below can hold
    // onto it. Undoing *chains* off this promise rather than racing it: these
    // actions take seconds against a remote database, and an undo that lands
    // first is simply deleted again when the removal it was undoing completes.
    const removal = removeFromCartAction(line.id);

    toast({
      variant: 'success',
      title: 'Removed from your bag',
      description: line.productName,
      action: {
        label: 'Undo',
        onClick: () => {
          void removal
            .then(() => undoRemoveAction(restore.variantId, restore.quantity))
            .then((undone) => {
              if (undone.count !== undefined) setCartCount(undone.count);
            });
        },
      },
    });

    startTransition(async () => {
      const result = await removal;
      if (result.count !== undefined) setCartCount(result.count);
      if (!result.ok) toast({ variant: 'error', title: result.message });
    });
  }

  function toggleSaved() {
    startTransition(async () => {
      const result = await saveForLaterAction(line.id, !line.savedForLater);
      if (result.count !== undefined) setCartCount(result.count);
      if (!result.ok) toast({ variant: 'error', title: result.message });
    });
  }

  return (
    <li
      className={cn(
        'flex gap-3 py-4 transition-opacity sm:gap-4',
        pending && 'opacity-60',
      )}
    >
      <Link
        href={line.href}
        className="shrink-0 overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        <MediaPlaceholder
          seed={line.imageSeed}
          ratio="square"
          className={compact ? 'size-16' : 'size-20 sm:size-24'}
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={line.href}
              className="line-clamp-2 text-sm font-medium text-foreground hover:text-accent-text"
            >
              {line.productName}
            </Link>
            <p className="mt-0.5 text-xs text-muted">{line.variantName}</p>
          </div>

          <Price
            cents={line.lineTotalCents}
            size="sm"
            className="shrink-0 text-right"
            aria-label={`Line total for ${line.productName}`}
          />
        </div>

        {line.quantityIssue ? (
          <p role="status" className="text-xs font-medium text-(--color-error)">
            {line.quantityIssue}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          {line.savedForLater ? null : (
            <QuantityStepper
              value={line.quantity}
              max={line.stock === 'BACKORDER' ? 99 : Math.max(1, line.availableQuantity)}
              disabled={pending}
              onChange={setQuantity}
              label={line.productName}
            />
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleSaved}
            disabled={pending}
            className="h-9 px-2 text-xs"
          >
            {line.savedForLater ? (
              <>
                <Undo2 aria-hidden="true" className="size-4" /> Move to bag
              </>
            ) : (
              <>
                <BookmarkPlus aria-hidden="true" className="size-4" /> Save for later
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={pending}
            className="h-9 px-2 text-xs text-muted hover:text-(--color-error)"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Remove<span className="sr-only"> {line.productName}</span>
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Quantity control.
 *
 * Buttons rather than a number input: on mobile a spinner is a 12px tap target
 * and the keyboard that opens over a `type="number"` field hides the cart total.
 * Every button is 44px, which is the real minimum for a thumb.
 */
function QuantityStepper({
  value,
  max,
  disabled,
  onChange,
  label,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center rounded-full border border-border">
      {/*
        Stops at one. Letting it fall to zero gave the row two controls with the
        identical accessible name "Remove <product>" — one deleting silently, one
        offering an undo. Assistive tech cannot tell them apart, and neither can a
        test: the removal path below is the only way out, and it is reversible.
      */}
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 1}
        aria-label={`Decrease quantity of ${label}`}
        className="flex size-11 items-center justify-center rounded-l-full text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>

      <span aria-live="polite" className="w-8 text-center text-sm font-medium tabular-nums">
        {value}
        <span className="sr-only"> of {label} in your bag</span>
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Increase quantity of ${label}`}
        className="flex size-11 items-center justify-center rounded-r-full text-foreground transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
