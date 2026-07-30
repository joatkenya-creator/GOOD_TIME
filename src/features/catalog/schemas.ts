import { z } from 'zod';

import { cursorQuerySchema } from '@/lib/api/pagination';

/**
 * Catalogue query contract.
 *
 * The same schema parses the storefront URL (`/shop?sort=price_asc&min=2000`) and
 * the API query string, so a filter UI and an API client can never disagree about
 * what a parameter means.
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

/** Comma-separated list in a URL becomes an array. `?category=a,b` -> ['a','b']. */
const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).max(20));

export const productFilterSchema = cursorQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: csv.optional(),
  brand: csv.optional(),
  collection: csv.optional(),
  tag: csv.optional(),
  /** Prices are always cents on the wire, never dollars. */
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStockOnly: z.stringbool().default(false),
  onSaleOnly: z.stringbool().default(false),
  sort: z.enum(PRODUCT_SORTS).default('relevance'),
});

export type ProductFilter = z.infer<typeof productFilterSchema>;

export const productSlugSchema = z.object({
  slug: z.string().min(1).max(96),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Enter at least two characters.').max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
