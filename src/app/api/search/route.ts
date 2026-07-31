import { searchQuerySchema } from '@/features/catalog/schemas';
import { readQuery, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import {
  getPopularSearches,
  getTrendingSearches,
  recordSearch,
  suggestProducts,
  suggestTaxonomy,
} from '@/services/search.service';

/**
 * `GET /api/search` — typeahead suggestions.
 *
 * Rate-limited harder than the rest of the catalogue: search-as-you-type is the
 * easiest endpoint on the site to hammer by accident, and the client already
 * debounces.
 *
 * Returns products *and* matching categories and collections, so a search for
 * "vibrators" offers the landing page rather than only individual items.
 */
export const GET = withRoute(
  async ({ request }) => {
    const { q, limit } = readQuery(request, searchQuerySchema);

    const [products, taxonomy] = await Promise.all([
      suggestProducts(q, limit),
      suggestTaxonomy(q, 3),
    ]);

    // Telemetry only — never awaited on the response path.
    void recordSearch(q, products.length);

    return jsonOk(
      { term: q, products, taxonomy },
      // Suggestions are public and highly repetitive across visitors.
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' } },
    );
  },
  { rateLimit: { bucket: 'search', limit: 90, windowSeconds: 60 } },
);

/**
 * `POST /api/search` — popular and trending terms for an empty search box.
 *
 * A POST because it takes no input and should not be cached alongside the GET
 * suggestions; a client calls it once when the search panel opens.
 */
export const POST = withRoute(
  async () => {
    const [popular, trending] = await Promise.all([getPopularSearches(8), getTrendingSearches(6)]);

    return jsonOk({ popular, trending });
  },
  { rateLimit: { bucket: 'search', limit: 60, windowSeconds: 60 } },
);
