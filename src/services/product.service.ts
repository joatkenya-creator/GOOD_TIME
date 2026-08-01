import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { ProductCardData } from '@/components/product/product-card';
import { facetToken } from '@/features/catalog/facets';
import type { ProductFilter, ProductSort } from '@/features/catalog/schemas';
import { PAGINATION } from '@/constants';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import {
  priceRange,
  resolvePrice,
  stockStatus,
  type StockStatus,
} from '@/features/catalog/pricing';

/**
 * Catalogue reads.
 *
 * The only module allowed to query products. Route handlers and pages call in
 * here; nothing above this layer writes a `where` clause.
 *
 * Every list query is built on three ideas that keep it fast at 100k products:
 *
 *   1. **Denormalised sort keys.** Price, rating and sales rank live on `Product`,
 *      so no sort needs an aggregate over variants, reviews or order items.
 *   2. **Facet tokens.** Multi-facet filtering is one GIN index scan over
 *      `Product.facets` rather than a join per facet.
 *   3. **Narrow selects.** A listing card needs eight fields. Fetching the full
 *      row plus every relation is what turns a 20ms query into 400ms.
 */

/** Live products only. Composed into every public query. */
const LIVE: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  deletedAt: null,
};

/**
 * Field set for a listing card. Deliberately minimal — adding to this is the
 * easiest way to make every listing page slower.
 */
const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortDescription: true,
  minPriceCents: true,
  maxPriceCents: true,
  currency: true,
  ratingAverage: true,
  ratingCount: true,
  isOnSale: true,
  isNewArrival: true,
  isFeatured: true,
  brand: { select: { name: true, slug: true } },
  primaryCategory: { select: { slug: true, path: true, name: true } },
  media: {
    // Two images: the card shows the first and swaps to the second on hover.
    take: 2,
    orderBy: { position: 'asc' },
    select: { media: { select: { publicId: true, url: true, alt: true } } },
  },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: { position: 'asc' },
    take: 1,
    select: {
      priceCents: true,
      salePriceCents: true,
      compareAtPriceCents: true,
      inventory: {
        select: { quantity: true, reserved: true, lowStockThreshold: true, policy: true },
      },
    },
  },
} satisfies Prisma.ProductSelect;

/**
 * Listing-card projection.
 *
 * Extends the `ProductCardData` contract the card component already defines, so
 * phase 2's placeholder content and real database rows render through exactly the
 * same component. Everything the card needs, nothing it does not.
 */
export interface ProductCardView extends ProductCardData {
  shortDescription: string | null;
  currency: string;
  discountPercent: number;
  stock: StockStatus;
}

/** Canonical product URL: `/shop/<category-path>/<slug>`. */
export function productHref(categoryPath: string | null | undefined, slug: string): string {
  const path = (categoryPath ?? '').replace(/^\/+/, '');
  return path ? `/shop/${path}/${slug}` : `/shop/${slug}`;
}

type CardRow = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

function toCardView(row: CardRow): ProductCardView {
  const variant = row.variants[0];
  const price = variant
    ? resolvePrice(variant)
    : {
        compareAtCents: null,
        discountPercent: 0,
        isOnSale: false,
        effectiveCents: 0,
        savingCents: 0,
      };

  // One badge, not a stack. A card wearing three badges communicates nothing, so
  // the most commercially useful signal wins.
  const badge: ProductCardData['badge'] =
    price.discountPercent > 0
      ? { label: `Save ${price.discountPercent}%`, variant: 'danger' }
      : row.isNewArrival
        ? { label: 'New', variant: 'accent' }
        : row.isFeatured
          ? { label: 'Best seller', variant: 'solid' }
          : null;

  const images = row.media.map((entry) => entry.media);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    href: productHref(row.primaryCategory?.path, row.slug),
    brand: row.brand?.name,
    priceCents: row.minPriceCents,
    maxPriceCents: row.maxPriceCents === row.minPriceCents ? null : row.maxPriceCents,
    compareAtPriceCents: price.compareAtCents,
    currency: row.currency,
    discountPercent: price.discountPercent,
    rating: row.ratingAverage,
    reviewCount: row.ratingCount,
    stock: stockStatus(variant?.inventory ?? null),
    badge,
    // `publicId` doubles as the deterministic placeholder seed until real
    // photography replaces it, so the card renders the same art every time.
    imageSeed: images[0]?.publicId ?? row.slug,
    hoverImageSeed: images[1]?.publicId ?? null,
    imageLabel: images[0]?.alt ?? row.name,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Translates a filter into a `where` clause.
 *
 * The critical detail: values within one facet namespace are OR-ed ("red or
 * blue") while namespaces are AND-ed ("red AND silicone"). Getting that backwards
 * gives a filter panel that returns nothing the moment two colours are ticked —
 * the classic faceted-search bug.
 */
export function buildProductWhere(
  filter: Partial<ProductFilter>,
  extra?: Prisma.ProductWhereInput,
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [LIVE];
  if (extra) and.push(extra);

  const namespaces = [
    ['brand', filter.brand],
    ['category', filter.category],
    ['collection', filter.collection],
    ['color', filter.color],
    ['size', filter.size],
    ['material', filter.material],
    ['tag', filter.tag],
  ] as const;

  for (const [namespace, values] of namespaces) {
    if (!values?.length) continue;
    // OR within the namespace.
    and.push({ facets: { hasSome: values.map((value) => facetToken(namespace, value)) } });
  }

  if (filter.minPriceCents !== undefined)
    and.push({ maxPriceCents: { gte: filter.minPriceCents } });
  if (filter.maxPriceCents !== undefined)
    and.push({ minPriceCents: { lte: filter.maxPriceCents } });
  if (filter.minRating) and.push({ ratingAverage: { gte: filter.minRating } });
  if (filter.onSaleOnly) and.push({ isOnSale: true });
  if (filter.newOnly) and.push({ isNewArrival: true });

  if (filter.inStockOnly) {
    // Availability is `quantity - reserved`, which Prisma cannot express as a
    // column comparison — so this approximates with "some variant has stock" and
    // the exact status is recomputed per card from the inventory row.
    and.push({
      variants: {
        some: { isActive: true, deletedAt: null, inventory: { quantity: { gt: 0 } } },
      },
    });
  }

  return { AND: and };
}

/** Deterministic ordering. Every sort ends with `id` so keyset paging is stable. */
function buildOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  const tiebreak: Prisma.ProductOrderByWithRelationInput = { id: 'asc' };

  switch (sort) {
    case 'newest':
      return [{ publishedAt: 'desc' }, tiebreak];
    case 'price_asc':
      return [{ minPriceCents: 'asc' }, tiebreak];
    case 'price_desc':
      return [{ minPriceCents: 'desc' }, tiebreak];
    case 'rating':
      return [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }, tiebreak];
    case 'best_selling':
      return [{ soldCount: 'desc' }, tiebreak];
    case 'relevance':
    default:
      // No search term to rank by, so "relevance" means merchandised order:
      // featured first, then best selling.
      return [{ isFeatured: 'desc' }, { soldCount: 'desc' }, tiebreak];
  }
}

export interface ProductListResult {
  items: ProductCardView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  nextCursor: string | null;
}

/**
 * Paginated, filtered listing.
 *
 * Offset paging by default because listing pages must be crawlable and linkable.
 * Pass `cursor` for infinite scroll, which stays constant-time however deep the
 * customer scrolls — `OFFSET 90000` scans 90,000 rows to return 24.
 */
export async function listProducts(
  filter: Partial<ProductFilter> & { cursor?: string; limit?: number },
  extra?: Prisma.ProductWhereInput,
): Promise<ProductListResult> {
  const where = buildProductWhere(filter, extra);
  const pageSize = Math.min(filter.limit ?? PAGINATION.defaultPageSize, PAGINATION.maxPageSize);
  const page = filter.page ?? 1;
  const orderBy = buildOrderBy(filter.sort ?? 'relevance');

  const useCursor = Boolean(filter.cursor);

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      select: CARD_SELECT,
      // Over-fetch by one to discover whether another page exists.
      take: pageSize + 1,
      ...(useCursor
        ? { cursor: { id: filter.cursor! }, skip: 1 }
        : { skip: (page - 1) * pageSize }),
    }),
    // `count` runs on the same predicate; Postgres answers it from the same index.
    prisma.product.count({ where }),
  ]);

  const hasMore = rows.length > pageSize;
  const items = (hasMore ? rows.slice(0, pageSize) : rows).map(toCardView);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

/**
 * A fixed-size rail: the first `limit` products by `sort`, and nothing else.
 *
 * `listProducts` answers "which page of how many", so it pairs every `findMany`
 * with a `count`. A homepage rail shows eight products and renders no
 * pagination, making that second query pure cost on the most-visited page —
 * two of them, since the page has two rails.
 *
 * Same predicate and same ordering as the listing, so a rail and the shop agree
 * about what "best selling" means.
 */
export async function listProductRail(
  sort: ProductSort,
  limit: number,
  extra?: Prisma.ProductWhereInput,
): Promise<ProductCardView[]> {
  const rows = await prisma.product.findMany({
    where: buildProductWhere({}, extra),
    orderBy: buildOrderBy(sort),
    select: CARD_SELECT,
    take: limit,
  });

  return rows.map(toCardView);
}

// ---------------------------------------------------------------------------
// Facet counts
// ---------------------------------------------------------------------------

export interface FacetCount {
  token: string;
  namespace: string;
  value: string;
  count: number;
}

/**
 * Counts per facet token for the current result set.
 *
 * Raw SQL because this is one `unnest` + `GROUP BY` over the filtered set, and
 * doing it through the ORM would mean pulling every matching row into Node just
 * to tally its array — fine at 17 products, catastrophic at 100k.
 *
 * The counts are computed *with* the current filter applied, so a facet showing
 * "(0)" is genuinely unavailable in combination with what is already selected.
 * That is what stops customers filtering their way into an empty page.
 */
export async function getFacetCounts(
  filter: Partial<ProductFilter>,
  categoryPathPrefix?: string,
): Promise<FacetCount[]> {
  const clauses: Prisma.Sql[] = [Prisma.sql`p."status" = 'ACTIVE' AND p."deletedAt" IS NULL`];

  if (categoryPathPrefix) {
    clauses.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "product_categories" pc
        JOIN "categories" c ON c."id" = pc."categoryId"
        WHERE pc."productId" = p."id" AND c."path" LIKE ${`${categoryPathPrefix}%`}
      )`,
    );
  }

  if (filter.minPriceCents !== undefined) {
    clauses.push(Prisma.sql`p."maxPriceCents" >= ${filter.minPriceCents}`);
  }
  if (filter.maxPriceCents !== undefined) {
    clauses.push(Prisma.sql`p."minPriceCents" <= ${filter.maxPriceCents}`);
  }
  if (filter.onSaleOnly) clauses.push(Prisma.sql`p."isOnSale" = true`);
  if (filter.newOnly) clauses.push(Prisma.sql`p."isNewArrival" = true`);

  const where = Prisma.join(clauses, ' AND ');

  const rows = await prisma.$queryRaw<{ token: string; count: bigint }[]>(Prisma.sql`
    SELECT token, COUNT(*)::bigint AS count
    FROM "products" p, unnest(p."facets") AS token
    WHERE ${where}
    GROUP BY token
    ORDER BY count DESC, token ASC
  `);

  return rows
    .map(({ token, count }) => {
      const separator = token.indexOf(':');
      return {
        token,
        namespace: separator > 0 ? token.slice(0, separator) : 'unknown',
        value: separator > 0 ? token.slice(separator + 1) : token,
        count: Number(count),
      };
    })
    .filter((facet) => facet.namespace !== 'unknown');
}

/** Min and max price across the filtered set, for the range slider bounds. */
export async function getPriceBounds(
  extra?: Prisma.ProductWhereInput,
): Promise<{ minCents: number; maxCents: number }> {
  const result = await prisma.product.aggregate({
    where: { AND: [LIVE, ...(extra ? [extra] : [])] },
    _min: { minPriceCents: true },
    _max: { maxPriceCents: true },
  });

  return {
    minCents: result._min.minPriceCents ?? 0,
    maxCents: result._max.maxPriceCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, ...LIVE },
    include: {
      brand: { select: { id: true, name: true, slug: true, description: true } },
      seo: true,
      primaryCategory: { select: { id: true, name: true, slug: true, path: true } },
      categories: {
        orderBy: { position: 'asc' },
        select: {
          category: { select: { id: true, name: true, slug: true, path: true, depth: true } },
        },
      },
      collections: {
        select: { collection: { select: { slug: true, title: true } } },
      },
      tags: { select: { slug: true, name: true } },
      media: {
        orderBy: { position: 'asc' },
        select: { position: true, media: true },
      },
      options: {
        orderBy: { position: 'asc' },
        include: { values: { orderBy: { position: 'asc' } } },
      },
      variants: {
        where: { deletedAt: null },
        orderBy: { position: 'asc' },
        include: {
          inventory: true,
          selections: { select: { valueId: true } },
        },
      },
      productAttributes: {
        include: { definition: true },
      },
    },
  });

  if (!product) return null;

  // Recompute the range on read rather than trusting the denormalised columns for
  // the page that actually takes the money. The listing can be a millisecond
  // stale; a product page cannot.
  const range = priceRange(product.variants);

  return { ...product, priceRange: range };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;

/** Slugs for `generateStaticParams` and the sitemap, newest first. */
export async function listProductSlugs(limit = 5000) {
  return prisma.product.findMany({
    where: LIVE,
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { slug: true, updatedAt: true, primaryCategory: { select: { path: true } } },
  });
}

/**
 * Related products, honouring curated order.
 *
 * Falls back to same-category best sellers when nothing is curated, so the slot
 * is never empty — an empty "you may also like" rail is worse than none.
 */
export async function getRelatedProducts(
  productId: string,
  type: 'RELATED' | 'FREQUENTLY_BOUGHT_TOGETHER' = 'RELATED',
  take = 8,
): Promise<ProductCardView[]> {
  const relations = await prisma.productRelation.findMany({
    where: { productId, type, related: LIVE },
    orderBy: [{ position: 'asc' }, { score: 'desc' }],
    take,
    select: { related: { select: CARD_SELECT } },
  });

  if (relations.length) return relations.map((relation) => toCardView(relation.related));
  if (type !== 'RELATED') return [];

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { primaryCategory: { select: { path: true } } },
  });

  const path = product?.primaryCategory?.path;
  if (!path) return [];

  /**
   * Widen up the tree until something is found.
   *
   * A product whose canonical category is a narrow leaf — `/vibrators/wands` with
   * one product in it — has no siblings, and returning nothing leaves an empty
   * rail on the page. Walking up to `/vibrators` finds the neighbours a shopper
   * would actually consider instead.
   */
  const candidatePaths = [path, ...ancestorPaths(path)];

  for (const candidate of candidatePaths) {
    const fallback = await prisma.product.findMany({
      where: {
        ...LIVE,
        id: { not: productId },
        categories: { some: { category: { path: { startsWith: candidate } } } },
      },
      orderBy: { soldCount: 'desc' },
      take,
      select: CARD_SELECT,
    });

    if (fallback.length) return fallback.map(toCardView);
  }

  return [];
}

/** `/a/b/c` -> `['/a/b', '/a']`, nearest ancestor first. */
function ancestorPaths(path: string): string[] {
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);

  return segments
    .slice(0, -1)
    .map((_, index) => `/${segments.slice(0, segments.length - 1 - index).join('/')}`)
    .filter((entry) => entry !== '/');
}

/** Hydrates an arbitrary id list into cards, for wishlist / compare / recently viewed. */
export async function getProductsByIds(ids: string[]): Promise<ProductCardView[]> {
  if (!ids.length) return [];

  const rows = await prisma.product.findMany({
    where: { ...LIVE, id: { in: ids.slice(0, PAGINATION.maxPageSize) } },
    select: CARD_SELECT,
  });

  // Preserve the caller's order — recency order is the whole point of the list.
  const byId = new Map(rows.map((row) => [row.id, toCardView(row)]));
  return ids.map((id) => byId.get(id)).filter((view): view is ProductCardView => Boolean(view));
}

export async function getProductsBySlugs(slugs: string[]): Promise<ProductCardView[]> {
  if (!slugs.length) return [];

  const rows = await prisma.product.findMany({
    where: { ...LIVE, slug: { in: slugs.slice(0, PAGINATION.maxPageSize) } },
    select: CARD_SELECT,
  });

  const bySlug = new Map(rows.map((row) => [row.slug, toCardView(row)]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((view): view is ProductCardView => Boolean(view));
}

/**
 * Fire-and-forget view counter.
 *
 * Deliberately not awaited by the page render, and deliberately not transactional:
 * a lost increment is irrelevant, whereas blocking a product page on a write is
 * not. Swap for a queued batch update if it ever shows up in the p99.
 */
export async function recordProductView(productId: string): Promise<void> {
  await prisma.product
    .update({ where: { id: productId }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);
}

export function assertProductFound<T>(product: T | null): T {
  if (!product) throw errors.notFound('Product');
  return product;
}
