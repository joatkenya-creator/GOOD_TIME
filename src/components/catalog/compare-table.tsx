'use client';

import { useQuery } from '@tanstack/react-query';
import { Scale, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Price } from '@/components/ui/price';
import { Rating } from '@/components/ui/rating';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/constants/routes';
import { useCompare } from '@/hooks/use-product-lists';
import { cn } from '@/utils/cn';

/** Shape returned by `/api/products/compare`. */
interface CompareProduct {
  id: string;
  slug: string;
  name: string;
  href: string;
  brandName: string | null;
  imageSeed: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  rating: number;
  reviewCount: number;
  stockLabel: string;
  attributes: { label: string; value: string; unit: string | null }[];
}

/**
 * Side-by-side comparison.
 *
 * Two decisions worth stating:
 *
 *   1. **A real `<table>`.** Comparison data is tabular, and a table gives screen
 *      readers row and column headers for free — which is the only way this is
 *      navigable non-visually. A grid of divs is not.
 *   2. **Identical rows are hidden by default.** Four products that are all
 *      "Platinum-cure silicone" tells the customer nothing. Showing only the
 *      differences is the entire purpose of the page; the toggle reveals the rest.
 */
export function CompareTable({ className }: { className?: string }) {
  const compare = useCompare();
  const [showIdentical, setShowIdentical] = useState(false);

  const idKey = compare.ids.join(',');

  const { data: products } = useQuery({
    queryKey: ['compare', idKey],
    enabled: idKey.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CompareProduct[]> => {
      const response = await fetch(`/api/products/compare?ids=${idKey}`);
      if (!response.ok) return [];

      const body: { ok: boolean; data: CompareProduct[] } = await response.json();
      return body.ok ? body.data : [];
    },
  });

  // `undefined` is "still loading"; an empty array is "nothing selected".
  if (idKey && products === undefined) {
    return (
      <div className={cn('grid gap-5 sm:grid-cols-2 lg:grid-cols-4', className)} aria-busy="true">
        <span className="sr-only">Loading comparison</span>
        {Array.from({ length: Math.max(2, compare.count) }, (_, index) => (
          <Skeleton key={index} className="aspect-[3/4] w-full" />
        ))}
      </div>
    );
  }

  if (!products?.length) {
    return (
      <EmptyState
        icon={<Scale />}
        title="Nothing selected to compare"
        description="Add up to four products from any listing using the compare button on a product card."
        className={className}
        action={
          <Button asChild>
            <Link href={ROUTES.shop}>Browse products</Link>
          </Button>
        }
      />
    );
  }

  // Union of every attribute label, so a product missing one still gets a row.
  const labels = [...new Set(products.flatMap((p) => p.attributes.map((a) => a.label)))];

  const rows = labels.map((label) => {
    const cells = products.map((product) => {
      const attribute = product.attributes.find((entry) => entry.label === label);
      return attribute ? `${attribute.value}${attribute.unit ? ` ${attribute.unit}` : ''}` : '—';
    });

    return { label, cells, identical: new Set(cells).size === 1 };
  });

  const visibleRows = showIdentical ? rows : rows.filter((row) => !row.identical);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className={className}>
      {hiddenCount > 0 ? (
        <label className="mb-6 flex cursor-pointer items-center gap-2.5 text-body-sm text-foreground-muted">
          <Checkbox
            checked={showIdentical}
            onChange={(event) => setShowIdentical(event.target.checked)}
          />
          Show {hiddenCount} {hiddenCount === 1 ? 'row' : 'rows'} where all products match
        </label>
      ) : null}

      {/* Horizontal scroll is contained here, never on the page body. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-body-sm">
          <caption className="sr-only">
            Comparison of {products.length} products by specification and price
          </caption>

          <thead>
            <tr>
              <th scope="col" className="w-40 border-b border-border p-3 text-left align-bottom">
                <span className="sr-only">Specification</span>
              </th>

              {products.map((product) => (
                <th
                  key={product.id}
                  scope="col"
                  className="border-b border-border p-3 text-left align-bottom"
                >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => compare.remove(product.id)}
                      aria-label={`Remove ${product.name} from comparison`}
                      className="absolute -top-1 -right-1 z-10 rounded-full bg-surface p-1 text-foreground-subtle shadow-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>

                    <Link href={product.href} className="block">
                      <MediaPlaceholder
                        seed={product.imageSeed}
                        ratio="product"
                        className="rounded-lg"
                      />
                      {product.brandName ? (
                        <span className="mt-3 block text-xs tracking-wide text-foreground-subtle uppercase">
                          {product.brandName}
                        </span>
                      ) : null}
                      <span className="mt-1 block font-medium text-foreground hover:text-accent-text">
                        {product.name}
                      </span>
                    </Link>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr className="odd:bg-surface-muted">
              <th scope="row" className="p-3 text-left font-medium text-foreground-muted">
                Price
              </th>
              {products.map((product) => (
                <td key={product.id} className="p-3">
                  <Price
                    cents={product.priceCents}
                    compareAtCents={product.compareAtPriceCents}
                    currency={product.currency}
                  />
                </td>
              ))}
            </tr>

            <tr className="odd:bg-surface-muted">
              <th scope="row" className="p-3 text-left font-medium text-foreground-muted">
                Rating
              </th>
              {products.map((product) => (
                <td key={product.id} className="p-3">
                  <Rating value={product.rating} count={product.reviewCount} size="sm" />
                </td>
              ))}
            </tr>

            <tr className="odd:bg-surface-muted">
              <th scope="row" className="p-3 text-left font-medium text-foreground-muted">
                Availability
              </th>
              {products.map((product) => (
                <td key={product.id} className="p-3 text-foreground">
                  {product.stockLabel}
                </td>
              ))}
            </tr>

            {visibleRows.map((row) => (
              <tr key={row.label} className="odd:bg-surface-muted">
                <th scope="row" className="p-3 text-left font-medium text-foreground-muted">
                  {row.label}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.label}-${index}`} className="p-3 text-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button variant="outline" onClick={compare.clear} className="mt-8">
        Clear comparison
      </Button>
    </div>
  );
}
