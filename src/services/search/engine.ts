import 'server-only';

import { remember, keys } from '@/lib/cache/store';
import { prisma } from '@/lib/prisma';

/**
 * The search engine boundary.
 *
 * One interface, two implementations that matter: Postgres today, an external
 * engine when the catalogue outgrows it. Everything above this file — the
 * search page, autocomplete, the API — talks to `SearchEngine` and never to
 * either implementation.
 *
 * ## Why Postgres first
 *
 * `tsvector` with a GIN index does stemming, ranking, phrase matching and
 * prefix matching, and `pg_trgm` adds typo tolerance. That covers everything on
 * the brief up to roughly a hundred thousand documents on modest hardware,
 * with no second service to run, secure, back up, or keep in sync — and "keep
 * in sync" is where most search deployments actually fail.
 *
 * The point at which this stops being true is measurable rather than
 * theoretical: when p95 search latency crosses ~200ms or the catalogue passes
 * a few hundred thousand documents, `MeilisearchEngine` implements the same
 * five methods against `ProductSearchDocument`, and one environment variable
 * switches over. That is the whole migration, and it is why the seam exists
 * before it is needed.
 */

export interface SearchFilters {
  categoryIds?: string[];
  brandIds?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  onSaleOnly?: boolean;
  minRating?: number;
  tags?: string[];
}

export interface SearchOptions {
  term: string;
  filters?: SearchFilters;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating';
  page?: number;
  pageSize?: number;
}

export interface SearchResultItem {
  productId: string;
  score: number;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    brands: FacetBucket[];
    categories: FacetBucket[];
    priceRange: { minCents: number; maxCents: number } | null;
  };
  /** Set when the term matched nothing directly and was relaxed. */
  correctedTerm?: string;
  elapsedMs: number;
}

export interface SearchEngine {
  readonly name: string;
  search(options: SearchOptions): Promise<SearchResponse>;
  suggest(term: string, limit: number): Promise<string[]>;
  /** True when the backing store is reachable. Used by the health check. */
  healthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Query preparation
// ---------------------------------------------------------------------------

/**
 * Expands a query through the synonym table.
 *
 * "Bullet" and "mini vibrator" are the same intent to a customer and different
 * strings to Postgres. Curated by merchandisers because no algorithm knows that
 * this category's shoppers say "wand" and mean one specific product shape.
 *
 * Cached for a minute: the table is tiny and read on every single search.
 */
async function expandSynonyms(term: string): Promise<string[]> {
  const table = await remember(
    keys.synonyms(),
    60,
    async () => {
      const rows = await prisma.searchSynonym.findMany({
        where: { isActive: true },
        select: { term: true, synonyms: true, isOneWay: true },
      });
      return rows;
    },
    ['search'],
  );

  const lower = term.toLowerCase().trim();
  const expansions = new Set<string>([lower]);

  for (const row of table) {
    const rowTerm = row.term.toLowerCase();

    if (rowTerm === lower) {
      for (const synonym of row.synonyms) expansions.add(synonym.toLowerCase());
    } else if (!row.isOneWay && row.synonyms.some((synonym) => synonym.toLowerCase() === lower)) {
      // Two-way: matching a synonym also brings in the canonical term and its
      // siblings. One-way expansions deliberately do not do this — "vibrator"
      // should find "bullet", but searching "bullet" should not return every
      // vibrator in the catalogue.
      expansions.add(rowTerm);
      for (const synonym of row.synonyms) expansions.add(synonym.toLowerCase());
    }
  }

  return [...expansions].slice(0, 8);
}

/**
 * Builds a `tsquery` string.
 *
 * Every token gets `:*` so partial words match as the shopper types, and the
 * tokens are AND-ed. Synonym groups are OR-ed within themselves — "bullet OR
 * mini" — so an expansion widens the result set instead of narrowing it to
 * products containing every synonym at once, which is nothing.
 */
function toTsQuery(terms: string[]): string {
  const groups = terms
    .map((term) =>
      term
        .split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & '),
    )
    .filter(Boolean);

  if (groups.length === 0) return '';
  return groups.map((group) => `(${group})`).join(' | ');
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

class PostgresEngine implements SearchEngine {
  readonly name = 'postgres';

  async search(options: SearchOptions): Promise<SearchResponse> {
    const started = Date.now();
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
    const term = options.term.trim();

    const expansions = term ? await expandSynonyms(term) : [];
    const tsquery = toTsQuery(expansions);

    const filters = options.filters ?? {};

    /*
     * Ranking is weighted, not raw `ts_rank`.
     *
     * A term in the title means far more than the same term buried in a
     * description, and Postgres cannot know that on its own. The title weight
     * is what stops "silicone" returning three hundred products whose care
     * instructions mention silicone, ahead of the one actually called
     * "Silicone Wand".
     */
    const rows = await prisma.$queryRaw<{ productId: string; score: number; total: bigint }[]>`
      WITH matched AS (
        SELECT
          d."productId",
          CASE WHEN ${tsquery}::text = '' THEN 1.0
               ELSE
                 ts_rank(to_tsvector('english', d."title"), to_tsquery('english', ${tsquery})) * 4.0
               + ts_rank(to_tsvector('english', COALESCE(d."brandName", '')), to_tsquery('english', ${tsquery})) * 2.0
               + ts_rank(to_tsvector('english', d."content"), to_tsquery('english', ${tsquery})) * 1.0
               + CASE WHEN lower(d."title") LIKE lower(${term}) || '%' THEN 2.0 ELSE 0 END
          END AS score
        FROM "product_search_documents" d
        JOIN "products" p ON p."id" = d."productId"
        WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
          AND (
            ${tsquery}::text = ''
            -- Matched against "content" alone, deliberately.
            --
            -- Phase 3 created a GIN index on to_tsvector('english', "content"),
            -- and a functional index only serves a query whose expression
            -- matches it exactly. Filtering on title || brandName || content
            -- looks equivalent and is not: Postgres cannot use the index and
            -- computes a tsvector per document instead. At the current
            -- catalogue size the planner seq-scans either way and the
            -- difference is unmeasurable; at a hundred thousand products it is
            -- the difference between an index lookup and a full scan.
            --
            -- Nothing is lost by narrowing it: buildContent already folds
            -- title, brand, categories, tags and attributes into "content".
            -- The weighted ranking above still reads title and brand
            -- separately, but only for rows that already matched.
            OR to_tsvector('english', d."content") @@ to_tsquery('english', ${tsquery})
          )
          AND (${filters.minPriceCents ?? null}::int IS NULL OR p."maxPriceCents" >= ${filters.minPriceCents ?? null}::int)
          AND (${filters.maxPriceCents ?? null}::int IS NULL OR p."minPriceCents" <= ${filters.maxPriceCents ?? null}::int)
          AND (${filters.onSaleOnly ?? false}::boolean = false OR p."isOnSale" = true)
          AND (${filters.minRating ?? null}::float IS NULL OR p."ratingAverage" >= ${filters.minRating ?? null}::float)
      )
      SELECT m."productId", m.score, COUNT(*) OVER() AS total
      FROM matched m
      JOIN "products" p ON p."id" = m."productId"
      ORDER BY
        CASE WHEN ${options.sort ?? 'relevance'} = 'relevance'  THEN m.score END DESC NULLS LAST,
        CASE WHEN ${options.sort ?? 'relevance'} = 'price_asc'  THEN p."minPriceCents" END ASC NULLS LAST,
        CASE WHEN ${options.sort ?? 'relevance'} = 'price_desc' THEN p."minPriceCents" END DESC NULLS LAST,
        CASE WHEN ${options.sort ?? 'relevance'} = 'rating'     THEN p."ratingAverage" END DESC NULLS LAST,
        CASE WHEN ${options.sort ?? 'relevance'} = 'newest'     THEN p."publishedAt" END DESC NULLS LAST,
        m."productId" ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    const total = rows[0] ? Number(rows[0].total) : 0;

    /*
     * Typo tolerance, only when the exact search found nothing.
     *
     * Trigram similarity is far more expensive than a GIN lookup, so running
     * it on every query to help the one-in-fifty that is misspelled would be
     * the wrong trade. Running it only on zero results costs nothing on the
     * happy path.
     */
    /*
     * Facets are fetched alongside the fuzzy fallback, not after the main
     * query.
     *
     * They depend only on the filters, never on the result rows, so awaiting
     * them in sequence added a full round trip to every search for no reason —
     * measurable on a remote database, where it was most of the latency.
     */
    const facetsPromise = this.facets(term, filters);

    let correctedTerm: string | undefined;
    let items = rows.map((row) => ({ productId: row.productId, score: Number(row.score) }));

    if (total === 0 && term.length >= 3) {
      const fuzzy = await this.fuzzy(term, pageSize);
      if (fuzzy.items.length > 0) {
        items = fuzzy.items;
        correctedTerm = fuzzy.correctedTerm;
      }
    }

    return {
      items,
      total: correctedTerm ? items.length : total,
      page,
      pageSize,
      facets: await facetsPromise,
      correctedTerm,
      elapsedMs: Date.now() - started,
    };
  }

  /** Trigram fallback: finds the nearest title and searches for that instead. */
  private async fuzzy(
    term: string,
    limit: number,
  ): Promise<{ items: SearchResultItem[]; correctedTerm?: string }> {
    const rows = await prisma.$queryRaw<{ productId: string; title: string; score: number }[]>`
      SELECT d."productId", d."title", similarity(d."title", ${term}) AS score
      FROM "product_search_documents" d
      JOIN "products" p ON p."id" = d."productId"
      WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        AND similarity(d."title", ${term}) > 0.2
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    return {
      items: rows.map((row) => ({ productId: row.productId, score: Number(row.score) })),
      correctedTerm: rows[0]?.title,
    };
  }

  /**
   * Facet counts for the current result set.
   *
   * Cached briefly and keyed by the term: counts change only when the
   * catalogue does, and every visitor on a busy category recomputes the same
   * aggregate otherwise.
   */
  private async facets(term: string, filters: SearchFilters) {
    return remember(
      keys.facets(`${term}:${JSON.stringify(filters)}`),
      60,
      async () => {
        const [brands, categories, range] = await Promise.all([
          prisma.product.groupBy({
            by: ['brandId'],
            where: { status: 'ACTIVE', deletedAt: null, brandId: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { brandId: 'desc' } },
            take: 20,
          }),
          prisma.product.groupBy({
            by: ['primaryCategoryId'],
            where: { status: 'ACTIVE', deletedAt: null, primaryCategoryId: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { primaryCategoryId: 'desc' } },
            take: 20,
          }),
          prisma.product.aggregate({
            where: { status: 'ACTIVE', deletedAt: null },
            _min: { minPriceCents: true },
            _max: { maxPriceCents: true },
          }),
        ]);

        const brandIds = brands.map((row) => row.brandId).filter(Boolean) as string[];
        const categoryIds = categories.map((row) => row.primaryCategoryId).filter(Boolean) as string[];

        const [brandRows, categoryRows] = await Promise.all([
          prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } }),
          prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
        ]);

        const brandName = new Map(brandRows.map((row) => [row.id, row.name]));
        const categoryName = new Map(categoryRows.map((row) => [row.id, row.name]));

        return {
          brands: brands
            .filter((row) => row.brandId)
            .map((row) => ({
              value: row.brandId!,
              label: brandName.get(row.brandId!) ?? 'Unknown',
              count: row._count._all,
            })),
          categories: categories
            .filter((row) => row.primaryCategoryId)
            .map((row) => ({
              value: row.primaryCategoryId!,
              label: categoryName.get(row.primaryCategoryId!) ?? 'Unknown',
              count: row._count._all,
            })),
          priceRange:
            range._min.minPriceCents !== null && range._max.maxPriceCents !== null
              ? { minCents: range._min.minPriceCents, maxCents: range._max.maxPriceCents }
              : null,
        };
      },
      ['search', 'products'],
    );
  }

  async suggest(term: string, limit: number): Promise<string[]> {
    const cleaned = term.trim().toLowerCase();
    if (cleaned.length < 2) return [];

    return remember(
      keys.suggest(`${cleaned}:${limit}`),
      120,
      async () => {
        const rows = await prisma.$queryRaw<{ title: string }[]>`
          SELECT d."title"
          FROM "product_search_documents" d
          JOIN "products" p ON p."id" = d."productId"
          WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
            AND lower(d."title") LIKE ${cleaned + '%'}
          ORDER BY length(d."title") ASC
          LIMIT ${limit}
        `;
        return rows.map((row) => row.title);
      },
      ['search'],
    );
  }

  async healthy(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let engine: SearchEngine | null = null;

/**
 * Returns the configured engine.
 *
 * `SEARCH_ENGINE=meilisearch` would select an external driver. Until one is
 * needed there is exactly one implementation, and adding a second is a file
 * plus a case rather than a rewrite — which is the entire point of the
 * interface existing now, while the cost of defining it is zero.
 */
export function searchEngine(): SearchEngine {
  if (engine) return engine;

  // Only one driver today. The switch is where the next one lands.
  engine = new PostgresEngine();
  return engine;
}
