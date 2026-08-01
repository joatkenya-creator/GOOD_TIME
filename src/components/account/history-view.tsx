'use client';

import { Clock, X } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';

import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { ROUTES } from '@/constants/routes';
import { clearHistoryAction, removeFromHistoryAction } from '@/server/actions/wishlist';
import type { ProductCardView } from '@/services/product.service';

/**
 * Browsing history, with per-item removal.
 *
 * The remove button sits over each card rather than in a menu: on a store like
 * this one, deleting something from your history is a primary action, not a
 * setting to go hunting for.
 */
export function HistoryView({
  entries,
}: {
  entries: { product: ProductCardView; viewedAt: Date }[];
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function remove(productId: string, name: string) {
    startTransition(async () => {
      const result = await removeFromHistoryAction(productId);
      toast({
        variant: result.ok ? 'success' : 'error',
        title: result.ok ? 'Removed from your history' : result.message,
        description: result.ok ? name : undefined,
      });
    });
  }

  function clearAll() {
    startTransition(async () => {
      const result = await clearHistoryAction();
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Clock aria-hidden="true" className="size-8" />}
        title="Nothing here yet"
        description="Products you look at while signed in show up here, so you can find them again."
        action={
          <Button asChild>
            <Link href={ROUTES.shop}>Browse the shop</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-foreground-muted">
          {entries.length} {entries.length === 1 ? 'product' : 'products'}
        </p>

        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={clearAll}
          className="text-foreground-muted hover:text-danger-700"
        >
          Clear history
        </Button>
      </div>

      <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-8 lg:grid-cols-3 xl:grid-cols-4">
        {entries.map((entry) => (
          <li key={entry.product.id} className="relative">
            <ProductCard product={entry.product} />

            <button
              type="button"
              disabled={pending}
              onClick={() => remove(entry.product.id, entry.product.name)}
              aria-label={`Remove ${entry.product.name} from your history`}
              className="absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-full bg-surface/90 text-foreground-muted shadow-sm backdrop-blur transition-colors hover:text-danger-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
