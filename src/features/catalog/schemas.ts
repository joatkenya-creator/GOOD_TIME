import { z } from 'zod';

import { cursorQuerySchema } from '@/lib/api/pagination';
import { FACET_NAMESPACES } from '@/features/catalog/facets';

/**
 * Catalogue query contract.
 *
 * The same schema parses the storefront URL (`/shop?sort=price_asc&color=rose`)
 * and the API query string, so a filter UI and an API client can never disagree
 * about what a parameter means. It is also what makes filter state shareable:
 * the URL *is* the state.
 */

export const PRODUCT_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'rating',
  'best_selling',
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const SORT_LABELS: Record<ProductSort, string> = {
  relevance: 'Most relevant',
  newest: 'Newest first',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Highest rated',
  best_selling: 'Best selling',
};

/** Comma-separated list in a URL becomes an array. `?color=rose,slate`. */
const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).max(30));

/**
 * One optional CSV parameter per facet namespace, generated from the namespace
 * list so adding a facet cannot be forgotten here.
 */
const facetShape = Object.fromEntries(
  FACET_NAMESPACES.map((namespace) => [namespace, csv.optional()]),
) as Record<(typeof FACET_NAMESPACES)[number], z.ZodOptional<typeof csv>>;

export const productFilterSchema = cursorQuerySchema.extend({
  ...facetShape,
  q: z.string().trim().min(1).max(120).optional(),
  /** Prices are always cents on the wire, never dollars. */
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStockOnly: z.stringbool().default(false),
  onSaleOnly: z.stringbool().default(false),
  newOnly: z.stringbool().default(false),
  sort: z.enum(PRODUCT_SORTS).default('relevance'),
  /** Offset paging for crawlable listing pages; cursor paging for infinite scroll. */
  page: z.coerce.number().int().min(1).default(1),
  view: z.enum(['grid', 'list']).default('grid'),
});

export type ProductFilter = z.infer<typeof productFilterSchema>;

export const productSlugSchema = z.object({ slug: z.string().min(1).max(96) });

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Enter at least two characters.').max(120),
  limit: z.coerce.number().int().min(1).max(24).default(8),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

export const reviewSortSchema = z.enum(['newest', 'helpful', 'highest', 'lowest']);
export type ReviewSort = z.infer<typeof reviewSortSchema>;

export const reviewFilterSchema = z.object({
  sort: reviewSortSchema.default('helpful'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  withPhotos: z.stringbool().default(false),
  page: z.coerce.number().int().min(1).default(1),
});

export type ReviewFilter = z.infer<typeof reviewFilterSchema>;

/**
 * Serialises a filter back into a query string.
 *
 * Defaults are omitted so the canonical URL of an unfiltered listing is `/shop`
 * rather than `/shop?sort=relevance&view=grid&page=1` — three URLs for one page
 * is a duplicate-content problem and a wasted crawl budget.
 */
export function filterToSearchParams(filter: Partial<ProductFilter>): URLSearchParams {
  const params = new URLSearchParams();

  for (const namespace of FACET_NAMESPACES) {
    const values = filter[namespace];
    if (values?.length) params.set(namespace, values.join(','));
  }

  if (filter.q) params.set('q', filter.q);
  if (filter.minPriceCents) params.set('minPriceCents', String(filter.minPriceCents));
  if (filter.maxPriceCents) params.set('maxPriceCents', String(filter.maxPriceCents));
  if (filter.minRating) params.set('minRating', String(filter.minRating));
  if (filter.inStockOnly) params.set('inStockOnly', 'true');
  if (filter.onSaleOnly) params.set('onSaleOnly', 'true');
  if (filter.newOnly) params.set('newOnly', 'true');
  if (filter.sort && filter.sort !== 'relevance') params.set('sort', filter.sort);
  if (filter.view && filter.view !== 'grid') params.set('view', filter.view);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));

  return params;
}

/** True when nothing narrowing is applied — used to decide `noindex` and canonicals. */
export function isUnfiltered(filter: ProductFilter): boolean {
  const hasFacet = FACET_NAMESPACES.some((namespace) => (filter[namespace]?.length ?? 0) > 0);

  return (
    !hasFacet &&
    !filter.q &&
    !filter.minPriceCents &&
    !filter.maxPriceCents &&
    !filter.minRating &&
    !filter.inStockOnly &&
    !filter.onSaleOnly &&
    !filter.newOnly
  );
}
