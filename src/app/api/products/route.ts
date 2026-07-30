import { productFilterSchema } from '@/features/catalog/schemas';
import { errors, readQuery, withRoute } from '@/lib/api/handler';

/**
 * `GET /api/products` — filtered, cursor-paginated catalogue listing.
 *
 * Contract is fixed in phase 1; the query lands with the catalogue in phase 2.
 *
 * Implementation notes for whoever picks this up:
 *   - filter on `Product.status = ACTIVE AND deletedAt IS NULL`, which the
 *     `[status, deletedAt, publishedAt]` index covers;
 *   - sort by the denormalised `minPriceCents` / `ratingAverage` columns rather
 *     than aggregating over variants and reviews per request;
 *   - use `cursorQuerySchema`, not offsets — see docs/architecture.md.
 */
export const GET = withRoute(
  async ({ request }) => {
    const filter = readQuery(request, productFilterSchema);
    void filter;

    throw errors.notImplemented('Product listing');
  },
  { rateLimit: { bucket: 'catalogue', limit: 240, windowSeconds: 60 } },
);
