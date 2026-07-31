import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { ROUTES } from '@/constants/routes';
import type { ProductCardView } from '@/services/product.service';
import { cn } from '@/utils/cn';

export interface ProductGridProps {
  products: ProductCardView[];
  layout?: 'grid' | 'list';
  className?: string;
}

/**
 * Product grid or list.
 *
 * A server component — the cards render as HTML and only their action buttons
 * hydrate. `<ol>` rather than `<div>`, because the order of results is meaningful
 * and a screen reader should announce "3 of 24".
 */
export function ProductGrid({ products, layout = 'grid', className }: ProductGridProps) {
  if (!products.length) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="No products match those filters"
        description="Try removing a filter, widening the price range, or searching for something more general."
        action={
          <Button variant="outline" asChild>
            <Link href={ROUTES.shop}>Clear filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ol
      className={cn(
        layout === 'list'
          ? 'flex flex-col gap-6'
          : 'grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} layout={layout} />
        </li>
      ))}
    </ol>
  );
}

/** Shape-matched fallback, so a streaming listing does not shift when it lands. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-3 xl:grid-cols-4"
    >
      <span className="sr-only">Loading products</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[3/4] w-full" />
          <SkeletonText lines={2} className="mt-4" />
          <Skeleton shape="text" className="mt-3 w-20" />
        </div>
      ))}
    </div>
  );
}
