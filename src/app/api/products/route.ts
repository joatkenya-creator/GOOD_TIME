import { productFilterSchema } from '@/features/catalog/schemas';
import { readQuery, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { cacheControl } from '@/lib/cache/cached';
import { getFacetCounts, listProducts } from '@/services/product.service';

/**
 * `GET /api/products` — filtered, paginated catalogue listing.
 *
 * Mirrors the storefront listing exactly: same schema, same service, so the API
 * and the rendered page can never disagree about what a filter means.
 *
 * `facets=true` additionally returns the counts for the current result set, which
 * is what a client-side filter UI needs to render availability.
 */
export const GET = withRoute(
  async ({ request }) => {
    const filter = readQuery(request, productFilterSchema);
    const wantsFacets = request.nextUrl.searchParams.get('facets') === 'true';

    const [result, facets] = await Promise.all([
      listProducts(filter),
      wantsFacets ? getFacetCounts(filter) : Promise.resolve(null),
    ]);

    return jsonOk(result.items, {
      meta: {
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          hasNext: result.page < result.totalPages,
          hasPrevious: result.page > 1,
        },
        nextCursor: result.nextCursor,
        ...(facets ? { facets } : {}),
      },
      // Public catalogue data: safe to cache at the CDN for every visitor.
      headers: { 'Cache-Control': cacheControl.catalogue },
    });
  },
  { rateLimit: { bucket: 'catalogue', limit: 240, windowSeconds: 60 } },
);
