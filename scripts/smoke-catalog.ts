import 'dotenv/config';

import {
  getCategoryByPath,
  getCategoryTrail,
  subtreeProductFilter,
} from '../src/services/category.service';
import {
  getFacetCounts,
  getPriceBounds,
  getProductBySlug,
  getRelatedProducts,
  listProducts,
  productHref,
} from '../src/services/product.service';
import { getRatingSummary, listProductReviews } from '../src/services/review.service';
import { searchProducts, suggestProducts } from '../src/services/search.service';

/**
 * Catalogue smoke test.
 *
 * Exercises every read path against the real database — the queries that matter
 * most are the ones a type-check cannot verify: raw SQL facet counts, full-text
 * ranking, and the trigram fuzzy fallback.
 *
 *   npx tsx scripts/smoke-catalog.ts
 */
async function main(): Promise<void> {
  const results: string[] = [];
  const check = (label: string, pass: boolean, detail = '') => {
    results.push(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    return pass;
  };

  // --- Listing ------------------------------------------------------------
  const all = await listProducts({
    sort: 'relevance',
    page: 1,
    limit: 12,
    view: 'grid',
    inStockOnly: false,
    onSaleOnly: false,
    newOnly: false,
  });
  check('listProducts returns rows', all.items.length > 0, `${all.items.length} of ${all.total}`);
  check(
    'card has a canonical href',
    Boolean(all.items[0]?.href?.startsWith('/shop/')),
    all.items[0]?.href,
  );
  check(
    'card carries a price',
    (all.items[0]?.priceCents ?? 0) > 0,
    `${all.items[0]?.priceCents}c`,
  );

  const byPrice = await listProducts({
    sort: 'price_asc',
    page: 1,
    limit: 50,
    view: 'grid',
    inStockOnly: false,
    onSaleOnly: false,
    newOnly: false,
  });
  const prices = byPrice.items.map((item) => item.priceCents);
  check(
    'price_asc is actually sorted',
    prices.every((price, index) => index === 0 || price >= prices[index - 1]!),
  );

  // --- Facets -------------------------------------------------------------
  const facets = await getFacetCounts({});
  const namespaces = [...new Set(facets.map((facet) => facet.namespace))];
  check(
    'facet counts computed (raw SQL)',
    facets.length > 0,
    `${facets.length} tokens across ${namespaces.length} namespaces`,
  );
  check(
    'facet namespaces look right',
    namespaces.includes('material') && namespaces.includes('brand'),
    namespaces.join(', '),
  );

  const materialFacet = facets.find((facet) => facet.namespace === 'material');
  if (materialFacet) {
    const filtered = await listProducts({
      material: [materialFacet.value],
      sort: 'relevance',
      page: 1,
      limit: 50,
      view: 'grid',
      inStockOnly: false,
      onSaleOnly: false,
      newOnly: false,
    });
    check(
      'facet filter matches its own count',
      filtered.total === materialFacet.count,
      `filter=${filtered.total} facet=${materialFacet.count}`,
    );
  }

  const bounds = await getPriceBounds();
  check(
    'price bounds derived',
    bounds.maxCents > bounds.minCents,
    `${bounds.minCents}–${bounds.maxCents}c`,
  );

  // --- Category -----------------------------------------------------------
  const category = await getCategoryByPath('/vibrators');
  check('category resolved by path', Boolean(category), category?.name);

  if (category) {
    const trail = await getCategoryTrail(category.path);
    check(
      'breadcrumb trail built',
      trail.length >= 2,
      trail.map((entry) => entry.name).join(' > '),
    );

    const inCategory = await listProducts(
      {
        sort: 'relevance',
        page: 1,
        limit: 50,
        view: 'grid',
        inStockOnly: false,
        onSaleOnly: false,
        newOnly: false,
      },
      subtreeProductFilter(category.path),
    );
    check(
      'subtree filter includes descendants',
      inCategory.total > 0,
      `${inCategory.total} products`,
    );
  }

  // --- Product detail ----------------------------------------------------
  const product = await getProductBySlug('aurora-rechargeable-wand');
  check('product resolved by slug', Boolean(product), product?.name);

  if (product) {
    check('variants loaded', product.variants.length > 0, `${product.variants.length}`);
    check('media loaded', product.media.length > 0, `${product.media.length}`);
    check(
      'specifications loaded',
      product.productAttributes.length > 0,
      `${product.productAttributes.length}`,
    );
    check(
      'price range recomputed',
      product.priceRange.maxPriceCents > 0,
      `${product.priceRange.minPriceCents}–${product.priceRange.maxPriceCents}c`,
    );
    check(
      'canonical href built',
      productHref(product.primaryCategory?.path, product.slug).includes('/shop/vibrators/'),
    );

    const summary = await getRatingSummary(product.id);
    check('rating summary computed', summary.total > 0, `${summary.average} from ${summary.total}`);
    check(
      'distribution sums to total',
      summary.distribution.reduce((sum, row) => sum + row.count, 0) === summary.total,
    );

    const reviews = await listProductReviews(product.id, {
      sort: 'helpful',
      withPhotos: false,
      page: 1,
    });
    check(
      'reviews listed',
      reviews.items.length > 0,
      `${reviews.items.length} of ${reviews.total}`,
    );

    const related = await getRelatedProducts(product.id, 'RELATED');
    check('related products found', related.length > 0, `${related.length}`);

    const fbt = await getRelatedProducts(product.id, 'FREQUENTLY_BOUGHT_TOGETHER', 4);
    check('frequently-bought-together found', fbt.length > 0, `${fbt.length}`);
  }

  // --- Search -------------------------------------------------------------
  const exact = await searchProducts('vibrator');
  check('full-text search returns hits', exact.items.length > 0, `${exact.total} for "vibrator"`);

  const phrase = await searchProducts('silicone dildo');
  check(
    'multi-word search returns hits',
    phrase.items.length > 0,
    `${phrase.total} for "silicone dildo"`,
  );

  const prefix = await suggestProducts('vibr');
  check('prefix suggestions work', prefix.length > 0, `${prefix.length} for "vibr"`);

  // The tier that matters most: a typo must not produce an empty page.
  const typo = await searchProducts('vibrater');
  check(
    'trigram fallback catches a typo',
    typo.items.length > 0,
    `${typo.total} for "vibrater" (fuzzy=${typo.isFuzzy})`,
  );

  const nonsense = await searchProducts('qqzzxx');
  check('genuine nonsense returns nothing', nonsense.items.length === 0);

  // --- Report -------------------------------------------------------------
  console.log('\n' + results.join('\n'));

  const failures = results.filter((line) => line.startsWith('FAIL'));
  console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);

  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
