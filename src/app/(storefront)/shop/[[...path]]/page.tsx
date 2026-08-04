import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CompareBar } from '@/components/catalog/compare-bar';
import { ListingView } from '@/components/catalog/listing-view';
import { ProductView } from '@/components/catalog/product-view';
import { siteConfig } from '@/config/site';
import { productFilterSchema, reviewFilterSchema, isUnfiltered } from '@/features/catalog/schemas';
import { buildMetadata } from '@/lib/seo/metadata';
import { breadcrumbs } from '@/lib/seo/breadcrumbs';
import {
  getCategoryByPath,
  getCategoryTrail,
  getChildCategories,
  getSiblingCategories,
  listCategoryPaths,
  segmentsToPath,
  subtreeProductFilter,
} from '@/services/category.service';
import {
  getFacetCounts,
  getPriceBounds,
  getProductBySlug,
  getRelatedProducts,
  listProductSlugs,
  listProducts,
  productHref,
  recordProductView,
} from '@/services/product.service';
import { recordView } from '@/services/recommendation.service';
import { getRatingSummary, listProductReviews } from '@/services/review.service';
import { getSessionUser } from '@/server/auth/session';

/**
 * The whole shop, on one route.
 *
 * `/shop`                              all products
 * `/shop/vibrators`                    category
 * `/shop/vibrators/wands`              nested category
 * `/shop/vibrators/wands/aurora-wand`  product
 *
 * One catch-all rather than separate `[category]` and `products/[slug]` routes,
 * because it gives products a single canonical URL that contains their category
 * path — which is both the requested URL shape and what keeps a product from
 * existing at three addresses just because it sits in three categories.
 *
 * Resolution order is category first, then product. Category paths are the more
 * common lookup and the cheaper query.
 */

type PageProps = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Prerenders the shop root, every category and every product at build time.
 *
 * Two reasons, one of them non-obvious:
 *
 *   1. **Performance.** These become static HTML served from the CDN instead of
 *      a database round trip per request — the single biggest win available on a
 *      catalogue that changes far less often than it is read. Unfiltered listings
 *      and product pages are the hottest paths on the site.
 *
 *   2. **Status codes.** Next resolves a prerendered path at the routing layer,
 *      before any rendering. That is the only place a real 404 can be produced
 *      for this route: `notFound()` called inside the page body — or even inside
 *      `generateMetadata` — arrives after Next has begun streaming the layout, so
 *      it renders the 404 page with a **200**. Verified, not assumed.
 *
 * `dynamicParams` stays at its default of `true`, so a product added through the
 * admin renders on demand without a rebuild. The cost of that choice is that an
 * *invalid* path under `/shop` still soft-404s: it renders the 404 page with a 200
 * and a `noindex` tag. The `noindex` is what keeps it out of the index; nothing
 * links to such a URL, so the exposure is hand-edited addresses and scrapers.
 *
 * At 100k products, drop products from this list and prerender categories only —
 * 100k build-time renders is not a trade worth making.
 */
export async function generateStaticParams(): Promise<{ path: string[] }[]> {
  const [categories, products] = await Promise.all([listCategoryPaths(), listProductSlugs(2000)]);

  return [
    // The shop root itself.
    { path: [] },

    ...categories.map((category) => ({
      path: category.path.replace(/^\/+/, '').split('/'),
    })),

    ...products.map((product) => ({
      path: productHref(product.primaryCategory?.path, product.slug)
        .replace(/^\/shop\/+/, '')
        .split('/'),
    })),
  ];
}

/** Normalises Next's `searchParams` into the flat record the Zod schemas expect. */
function flatten(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? (value[0] ?? '') : value!]),
  );
}

/**
 * Resolves a path to a category, a product, or nothing.
 *
 * Called by both `generateMetadata` and the page body. The lookups it calls are
 * wrapped in React's `cache()`, so the work happens once per request despite the
 * two callers — this comment used to claim that happened automatically, and it
 * does not. Next de-duplicates `fetch`, not Prisma.
 */
async function resolve(segments: string[]) {
  if (!segments.length) return { kind: 'shop' as const };

  const path = segmentsToPath(segments);
  const category = await getCategoryByPath(path);
  if (category) return { kind: 'category' as const, category };

  // Last segment might be a product slug hanging off a category path.
  const slug = segments.at(-1)!;
  const product = await getProductBySlug(slug);
  if (product) return { kind: 'product' as const, product };

  return { kind: 'missing' as const };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { path = [] } = await params;
  const resolved = await resolve(path);
  const query = flatten(await searchParams);

  /**
   * An unresolvable path renders the 404 page, but Next cannot set a 404 *status*
   * from here — see the `generateStaticParams` note below. `noindex` is therefore
   * load-bearing rather than belt-and-braces: it is what stops a soft 404 being
   * indexed.
   */
  if (resolved.kind === 'missing') {
    return buildMetadata({ title: 'Page not found', noindex: true, nofollow: true });
  }

  if (resolved.kind === 'product') {
    const { product } = resolved;
    const canonical = productHref(product.primaryCategory?.path, product.slug);

    // Reached at a non-canonical path: render the 404 page, and keep it out of
    // the index. See the note in the page body.
    if (`/shop/${path.join('/')}` !== canonical) {
      return buildMetadata({ title: 'Page not found', noindex: true, nofollow: true });
    }

    return buildMetadata({
      title:
        product.seo?.title ?? `${product.name}${product.brand ? ` — ${product.brand.name}` : ''}`,
      description:
        product.seo?.description ??
        product.shortDescription ??
        `${product.name}. Body-safe materials, published specifications, free discreet shipping over $75.`,
      path: canonical,
      type: 'product',
      keywords: product.seo?.keywords?.length
        ? product.seo.keywords
        : product.tags.map((tag) => tag.name),
      noindex: product.seo?.noindex ?? false,
    });
  }

  const filter = productFilterSchema.parse(query);
  const isCategory = resolved.kind === 'category';
  const basePath = isCategory ? `/shop${resolved.category.path}` : '/shop';

  const title = isCategory
    ? (resolved.category.seo?.title ?? `${resolved.category.name} — ${siteConfig.name}`)
    : `Shop all products — ${siteConfig.name}`;

  const description = isCategory
    ? (resolved.category.seo?.description ?? resolved.category.description ?? undefined)
    : 'Every product we stock: body-safe materials, published specifications, and free discreet shipping over $75.';

  return buildMetadata({
    title,
    description: description ?? undefined,
    path: basePath,
    // Paginated pages get a canonical that includes the page number; every other
    // filter combination canonicalises to the clean listing URL. Otherwise a
    // handful of facets multiplies into thousands of near-duplicate URLs.
    canonicalParams: filter.page > 1 ? { page: filter.page } : {},
    // A filtered view has no independent search value and would dilute the
    // category page it was reached from.
    noindex: !isUnfiltered(filter),
  });
}

export default async function ShopPage({ params, searchParams }: PageProps) {
  const { path = [] } = await params;
  const resolved = await resolve(path);
  const query = flatten(await searchParams);

  if (resolved.kind === 'missing') notFound();

  // ---------------------------------------------------------------- product
  if (resolved.kind === 'product') {
    const { product } = resolved;
    const canonicalPath = productHref(product.primaryCategory?.path, product.slug);
    const requestedPath = `/shop/${path.join('/')}`;

    /**
     * A product is served at exactly one URL.
     *
     * This was a `permanentRedirect` first, which does not work here: by the time
     * the page resolves its data Next has already begun streaming the layout, so
     * the redirect cannot set a status code and degrades to a 200 with a
     * `<meta http-equiv="refresh">`. Google treats that as a *soft* redirect — it
     * consolidates nothing while looking like it does, which is worse than not
     * redirecting at all.
     *
     * So a non-canonical path is simply not a page. Nothing generates one:
     * `productHref` builds every internal link, the sitemap and the canonical
     * tag, so the only way to reach here is a hand-edited URL.
     *
     * If a product is ever recategorised, its old URL needs an explicit entry in
     * `next.config.ts` `redirects()` — which does emit a real 308, because it
     * runs before rendering starts.
     */
    if (requestedPath !== canonicalPath) notFound();

    const reviewFilter = reviewFilterSchema.parse(query);

    const [summary, reviews, related, frequentlyBoughtTogether, trail] = await Promise.all([
      getRatingSummary(product.id),
      listProductReviews(product.id, reviewFilter),
      getRelatedProducts(product.id, 'RELATED'),
      getRelatedProducts(product.id, 'FREQUENTLY_BOUGHT_TOGETHER', 4),
      product.primaryCategory
        ? getCategoryTrail(product.primaryCategory.path)
        : Promise.resolve(breadcrumbs({ name: 'Shop', path: '/shop' })),
    ]);

    // Not awaited: a page render must never block on a counter.
    void recordProductView(product.id);

    // The durable, per-customer half of browsing history. Guests keep theirs in
    // `localStorage`; this is what survives a new device and feeds the
    // recommendation heuristics.
    const viewer = await getSessionUser();
    if (viewer) void recordView(viewer.id, product.id);

    const buildReviewHref = (page: number) => {
      const next = new URLSearchParams(query);
      if (page > 1) next.set('page', String(page));
      else next.delete('page');
      const qs = next.toString();
      return `${canonicalPath}${qs ? `?${qs}` : ''}#reviews`;
    };

    return (
      <>
        <ProductView
          product={product}
          trail={[...trail, { name: product.name, path: canonicalPath }]}
          canonicalPath={canonicalPath}
          summary={summary}
          reviews={reviews.items}
          reviewPage={reviews.page}
          reviewTotalPages={reviews.totalPages}
          buildReviewHref={buildReviewHref}
          related={related}
          frequentlyBoughtTogether={frequentlyBoughtTogether}
        />
        <CompareBar />
      </>
    );
  }

  // --------------------------------------------------------------- listing
  const filter = productFilterSchema.parse(query);
  const isCategory = resolved.kind === 'category';
  const category = isCategory ? resolved.category : null;
  const basePath = category ? `/shop${category.path}` : '/shop';

  // Category pages list the whole subtree, not just directly-assigned products —
  // otherwise a parent category shows almost nothing.
  const scope = category ? subtreeProductFilter(category.path) : undefined;

  const [result, facets, priceBounds, children, siblings, trail] = await Promise.all([
    listProducts(filter, scope),
    getFacetCounts(filter, category?.path),
    getPriceBounds(scope),
    category ? getChildCategories(category.id) : Promise.resolve([]),
    category ? getSiblingCategories(category) : Promise.resolve([]),
    category ? getCategoryTrail(category.path) : Promise.resolve([{ name: 'Shop', path: '/shop' }]),
  ]);

  return (
    <>
      <ListingView
        title={category?.name ?? 'All products'}
        description={category?.description ?? null}
        heroHeadline={category?.heroHeadline ?? null}
        heroBody={category?.heroBody ?? null}
        trail={trail}
        filter={filter}
        result={result}
        facets={facets}
        priceBounds={priceBounds}
        childLinks={children.map((child) => ({
          name: child.name,
          href: `/shop${child.path}`,
          count: child._count.products,
        }))}
        relatedLinks={siblings.map((sibling) => ({
          name: sibling.name,
          href: `/shop${sibling.path}`,
        }))}
        basePath={basePath}
      />
      <CompareBar />
    </>
  );
}
