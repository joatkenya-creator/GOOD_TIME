import { searchQuerySchema } from '@/features/catalog/schemas';
import { errors, readQuery, withRoute } from '@/lib/api/handler';

/**
 * `GET /api/search` — typeahead and full search.
 *
 * Rate-limited harder than the rest of the catalogue: search-as-you-type is the
 * easiest endpoint on the site to accidentally hammer.
 *
 * Implementation notes: start with Postgres full-text (`tsvector` column plus a
 * GIN index, `pg_trgm` for fuzzy matching) rather than reaching for a hosted
 * search service. At 100k products that is fast, free and one migration.
 */
export const GET = withRoute(
  async ({ request }) => {
    const query = readQuery(request, searchQuerySchema);
    void query;

    throw errors.notImplemented('Search');
  },
  { rateLimit: { bucket: 'search', limit: 60, windowSeconds: 60 } },
);
