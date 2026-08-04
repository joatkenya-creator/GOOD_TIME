import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { productHref, type ProductCardView, getProductsByIds } from '@/services/product.service';

/**
 * Search.
 *
 * Postgres full-text, not a hosted search service. At this catalogue size a GIN
 * index over `to_tsvector('english', content)` answers in single-digit
 * milliseconds, costs nothing, and needs no sync pipeline that can silently drift
 * out of date. Revisit when measurements say otherwise, not before.
 *
 * Three tiers, tried in order:
 *
 *   1. `websearch_to_tsquery` — handles quoted phrases and `-exclusions` the way
 *      a customer expects from a search box.
 *   2. Prefix match — so "vibr" matches while the customer is still typing.
 *   3. Trigram similarity — so "vibrater" still finds "vibrator" instead of
 *      returning nothing, which is when visitors leave.
 *
 * ## Preparing for semantic search
 *
 * `searchProducts` is the single entry point and returns ranked product ids. A
 * future vector search replaces the body of `rankedProductIds` — add an
 * `embedding vector(1536)` column, an HNSW index and a cosine-distance ORDER BY,
 * then blend the two scores. Nothing above this function needs to change.
 */

export interface SearchHit {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  categoryPath: string | null;
  href: string;
  /** Server-computed `<mark>` ranges are avoided; the client highlights instead. */
  rank: number;
}

/** Minimum trigram similarity for the fuzzy tier. Below this, matches are noise. */
const SIMILARITY_FLOOR = 0.3;

/**
 * Ranked product ids for a term.
 *
 * Returns ids rather than rows so the caller reuses the shared card projection
 * and there is exactly one definition of what a product card contains.
 */
async function rankedProductIds(
  term: string,
  limit: number,
): Promise<{ id: string; rank: number }[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  // Tier 1 and 2 combined: full-text OR prefix, ranked by ts_rank.
  const prefixQuery = `${trimmed
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .join(' & ')}:*`;

  const full = await prisma.$queryRaw<{ productId: string; rank: number }[]>(Prisma.sql`
    SELECT d."productId",
           GREATEST(
             ts_rank(to_tsvector('english', d."content"), websearch_to_tsquery('english', ${trimmed})),
             ts_rank(to_tsvector('english', d."content"), to_tsquery('english', ${prefixQuery}))
           ) AS rank
    FROM "product_search_documents" d
    JOIN "products" p ON p."id" = d."productId"
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
      AND (
        to_tsvector('english', d."content") @@ websearch_to_tsquery('english', ${trimmed})
        OR to_tsvector('english', d."content") @@ to_tsquery('english', ${prefixQuery})
      )
    ORDER BY rank DESC, p."soldCount" DESC
    LIMIT ${limit}
  `);

  if (full.length) return full.map((row) => ({ id: row.productId, rank: row.rank }));

  // Tier 3: trigram similarity on the title only. Running it over the whole
  // document produces confident nonsense.
  const fuzzy = await prisma.$queryRaw<{ productId: string; rank: number }[]>(Prisma.sql`
    SELECT d."productId", similarity(d."title", ${trimmed}) AS rank
    FROM "product_search_documents" d
    JOIN "products" p ON p."id" = d."productId"
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
      AND similarity(d."title", ${trimmed}) > ${SIMILARITY_FLOOR}
    ORDER BY rank DESC
    LIMIT ${limit}
  `);

  return fuzzy.map((row) => ({ id: row.productId, rank: row.rank }));
}

export interface SearchResult {
  term: string;
  items: ProductCardView[];
  total: number;
  /** True when the fuzzy tier produced the results — the UI says "showing results for". */
  isFuzzy: boolean;
}

/**
 * The storefront's search.
 *
 * Routed through the phase 7 engine rather than the phase 3 query, so a
 * shopper actually gets the synonyms a merchandiser curated and the typo
 * tolerance the index supports. The engine is an interface with a Postgres
 * driver behind it; swapping in Meilisearch changes this file not at all.
 *
 * The phase 3 helpers below are kept because they still serve typeahead and
 * the taxonomy suggestions, which want ids and names rather than a full
 * ranked page.
 */
export async function searchProducts(term: string, limit = 24): Promise<SearchResult> {
  const { searchEngine } = await import('@/services/search/engine');

  const response = await searchEngine().search({ term, pageSize: limit });
  const items = await getProductsByIds(response.items.map((hit) => hit.productId));

  return {
    term,
    items,
    total: response.total,
    // The engine reports this directly: it relaxed the query and says so,
    // rather than the caller inferring it from a score threshold.
    isFuzzy: Boolean(response.correctedTerm),
  };
}

/** Lightweight typeahead: ids, names and hrefs only, no card projection. */
export async function suggestProducts(term: string, limit = 6): Promise<SearchHit[]> {
  const ranked = await rankedProductIds(term, limit);
  if (!ranked.length) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: ranked.map((row) => row.id) } },
    select: {
      id: true,
      slug: true,
      name: true,
      brand: { select: { name: true } },
      primaryCategory: { select: { path: true } },
    },
  });

  const byId = new Map(products.map((product) => [product.id, product]));

  return ranked
    .map(({ id, rank }) => {
      const product = byId.get(id);
      if (!product) return null;

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        brandName: product.brand?.name ?? null,
        categoryPath: product.primaryCategory?.path ?? null,
        href: productHref(product.primaryCategory?.path, product.slug),
        rank,
      };
    })
    .filter((hit): hit is SearchHit => hit !== null);
}

/** Matching category and collection names, so search reaches landing pages too. */
export async function suggestTaxonomy(term: string, limit = 4) {
  const [categories, collections] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, deletedAt: null, name: { contains: term, mode: 'insensitive' } },
      take: limit,
      select: { name: true, path: true },
    }),
    prisma.collection.findMany({
      where: { isActive: true, title: { contains: term, mode: 'insensitive' } },
      take: limit,
      select: { title: true, slug: true },
    }),
  ]);

  return [
    ...categories.map((entry) => ({
      label: entry.name,
      href: `/shop${entry.path}`,
      kind: 'Category' as const,
    })),
    ...collections.map((entry) => ({
      label: entry.title,
      href: `/collections/${entry.slug}`,
      kind: 'Collection' as const,
    })),
  ];
}

/**
 * Most-searched terms of all time. Cached — this changes slowly and is rendered
 * on an empty search box, which is the hottest path on the page.
 */
export async function getPopularSearches(limit = 8): Promise<string[]> {
  const rows = await prisma.searchQuery.groupBy({
    by: ['term'],
    _count: { term: true },
    where: { resultCount: { gt: 0 } },
    orderBy: { _count: { term: 'desc' } },
    take: limit,
  });

  return rows.map((row) => row.term);
}

/** Rising terms over the last 24 hours. */
export async function getTrendingSearches(limit = 6): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await prisma.searchQuery.groupBy({
    by: ['term'],
    _count: { term: true },
    where: { createdAt: { gte: since }, resultCount: { gt: 0 } },
    orderBy: { _count: { term: 'desc' } },
    take: limit,
  });

  return rows.map((row) => row.term);
}

/**
 * Records a query for the popular/trending lists and the zero-result report.
 *
 * Never awaited on the render path — telemetry must not be able to slow down or
 * fail a search.
 */
export async function recordSearch(
  term: string,
  resultCount: number,
  userId?: string,
): Promise<void> {
  const normalised = term.trim().toLowerCase();
  if (normalised.length < 2) return;

  await prisma.searchQuery
    .create({ data: { term: normalised, resultCount, userId: userId ?? null } })
    .catch(() => undefined);
}

/**
 * Fallbacks for an empty result set.
 *
 * A dead end loses the visitor, so a no-results page always offers the popular
 * terms, the best sellers, and the top-level categories.
 */
export async function getNoResultSuggestions(): Promise<{
  popular: string[];
  bestSellers: ProductCardView[];
}> {
  const [popular, bestSellerIds] = await Promise.all([
    getPopularSearches(6),
    prisma.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: { soldCount: 'desc' },
      take: 4,
      select: { id: true },
    }),
  ]);

  return {
    popular,
    bestSellers: await getProductsByIds(bestSellerIds.map((row) => row.id)),
  };
}
