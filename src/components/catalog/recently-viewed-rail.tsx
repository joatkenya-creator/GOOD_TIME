'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { ProductCard, type ProductCardData } from '@/components/product/product-card';
import { Carousel } from '@/components/ui/carousel';
import { recentlyViewedStore } from '@/features/catalog/local-list';
import { useRecentlyViewed } from '@/hooks/use-product-lists';

export interface RecentlyViewedRailProps {
  /** Recorded as viewed, and excluded from its own rail. */
  currentProductId?: string;
  canonicalPath?: string;
  title?: string;
}

/**
 * Recently viewed rail.
 *
 * A client component because the list lives in `localStorage` — it is
 * per-browser, so it cannot be server-rendered without making every product page
 * dynamic and uncacheable. That trade is the whole reason the list is local.
 *
 * Cards are fetched through TanStack Query rather than a hand-rolled effect: it
 * handles the request lifecycle, dedupes across components and caches between
 * navigations, so moving between two product pages reuses the same response.
 */
export function RecentlyViewedRail({
  currentProductId,
  title = 'Recently viewed',
}: RecentlyViewedRailProps) {
  const { othersThan } = useRecentlyViewed();

  // Record the visit. An external-store write, not component state — every
  // subscriber (including this one) re-renders from the store.
  useEffect(() => {
    if (currentProductId) recentlyViewedStore.add(currentProductId);
  }, [currentProductId]);

  const ids = othersThan(currentProductId ?? '').slice(0, 12);

  const { data: products = [] } = useQuery({
    // Keyed on the id list, so navigating to a new product refetches while the
    // previous rail stays visible.
    queryKey: ['recently-viewed', ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProductCardData[]> => {
      const response = await fetch(`/api/products/lookup?ids=${ids.join(',')}`);
      if (!response.ok) return [];

      const body: { ok: boolean; data: ProductCardData[] } = await response.json();
      return body.ok ? body.data : [];
    },
  });

  // Fewer than two is not a rail worth the vertical space.
  if (products.length < 2) return null;

  return (
    <section
      aria-labelledby="recently-viewed-heading"
      className="mt-20 border-t border-border pt-12"
    >
      <h2 id="recently-viewed-heading" className="text-display-md text-foreground">
        {title}
      </h2>

      <Carousel label="Recently viewed products" className="mt-8">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} fixedWidth />
        ))}
      </Carousel>
    </section>
  );
}
