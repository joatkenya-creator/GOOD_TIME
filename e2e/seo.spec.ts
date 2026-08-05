import { expect, gotoFirstProduct, test } from './fixtures';

/**
 * SEO, asserted against rendered HTML rather than against the metadata objects.
 *
 * The distinction matters. A unit test on `generateMetadata` proves the function
 * returns the right shape; it says nothing about whether Next actually emitted
 * it, whether a layout overrode it, or whether two pages ended up with the same
 * canonical. Every failure that has ever cost real traffic lives in that gap.
 */

const INDEXABLE = [
  { path: '/', name: 'home' },
  { path: '/shop', name: 'catalogue' },
];

test.describe('metadata', () => {
  for (const page of INDEXABLE) {
    test(`${page.name} has a title, description and canonical`, async ({ shopper }) => {
      await shopper.goto(page.path);

      const title = await shopper.title();
      expect(title.length).toBeGreaterThan(10);
      // Google truncates around 60 characters; longer is not penalised but is
      // wasted, because nobody reads the part that is cut off.
      expect(title.length).toBeLessThan(70);

      const description = await shopper.locator('meta[name="description"]').getAttribute('content');
      expect(description?.length ?? 0).toBeGreaterThan(50);
      expect(description!.length).toBeLessThan(165);

      const canonical = await shopper.locator('link[rel="canonical"]').getAttribute('href');
      // Absolute, always. A relative canonical is resolved against the current
      // URL, which makes every filtered listing canonical to itself — the exact
      // duplicate-content problem the tag exists to solve.
      expect(canonical).toMatch(/^https?:\/\//);
    });
  }

  test('a filtered listing canonicalises to the unfiltered page', async ({ shopper }) => {
    await shopper.goto('/shop?sort=price-asc&page=2');

    const canonical = await shopper.locator('link[rel="canonical"]').getAttribute('href');

    /*
     * Sort orders and filters multiply one page into hundreds of near-identical
     * URLs. Left uncanonicalised, the crawl budget goes to permutations instead
     * of products, and the ranking signal is split across all of them.
     */
    expect(canonical).not.toContain('sort=');
  });

  test('no two indexable pages share a title', async ({ shopper }) => {
    const titles = new Map<string, string>();

    for (const page of INDEXABLE) {
      await shopper.goto(page.path);
      const title = await shopper.title();

      const duplicate = titles.get(title);
      expect(duplicate, `${page.path} has the same title as ${duplicate}`).toBeUndefined();

      titles.set(title, page.path);
    }
  });
});

test.describe('social cards', () => {
  test('Open Graph and Twitter tags are complete', async ({ shopper }) => {
    await shopper.goto('/');

    const og = async (property: string) =>
      shopper.locator(`meta[property="og:${property}"]`).first().getAttribute('content');

    expect(await og('title')).toBeTruthy();
    expect(await og('description')).toBeTruthy();
    expect(await og('url')).toMatch(/^https?:\/\//);
    expect(await og('type')).toBeTruthy();

    // A card with no image is rendered as a bare grey link. That is the
    // difference between a shared product and an ignored one.
    const image = await og('image');
    expect(image).toMatch(/^https?:\/\//);

    const twitterCard = await shopper.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(twitterCard).toBe('summary_large_image');
  });
});

test.describe('structured data', () => {
  test('the home page declares an Organization and a WebSite', async ({ shopper }) => {
    await shopper.goto('/');

    const blocks = await shopper.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBeGreaterThan(0);

    const types = blocks.flatMap((block) => {
      // Must parse. Invalid JSON-LD is silently dropped by every consumer, so
      // a syntax error looks exactly like having no structured data at all.
      const parsed = JSON.parse(block);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      return nodes.flatMap((node) =>
        (node['@graph'] ?? [node]).map((entry: never) => entry['@type']),
      );
    });

    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  test('a product page declares a Product with an offer', async ({ shopper }) => {
    await gotoFirstProduct(shopper);

    const blocks = await shopper.locator('script[type="application/ld+json"]').allTextContents();
    const nodes = blocks.flatMap((block) => {
      const parsed = JSON.parse(block);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.flatMap((node) => node['@graph'] ?? [node]);
    });

    const product = nodes.find((node: { '@type': string }) => node['@type'] === 'Product') as
      Record<string, unknown> | undefined;

    expect(product).toBeDefined();

    // Without `offers` the rich result carries no price and Google will not
    // show it as a product at all — it becomes an ordinary blue link.
    const offers = product!.offers as Record<string, unknown>;
    expect(offers).toBeDefined();
    expect(offers.price ?? (offers as { lowPrice?: string }).lowPrice).toBeDefined();
    expect(offers.priceCurrency).toBe('USD');
    expect(String(offers.availability)).toContain('schema.org');
  });

  test('breadcrumbs are declared, not just drawn', async ({ shopper }) => {
    await shopper.goto('/shop');

    const blocks = await shopper.locator('script[type="application/ld+json"]').allTextContents();
    const hasBreadcrumbs = blocks.some((block) => block.includes('BreadcrumbList'));

    // The visual breadcrumb helps a human; the JSON-LD is what puts the
    // category path into the search result instead of a bare URL.
    expect(hasBreadcrumbs).toBe(true);
  });
});

test.describe('crawlability', () => {
  test('robots.txt points at the sitemap index', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/robots.txt`);
    const body = await response.text();

    expect(response.status()).toBe(200);
    expect(body).toContain('Sitemap:');
    // Checkout and account pages must never be crawled — they are per-customer
    // and several of them leak an order number into a search index.
    expect(body).toMatch(/Disallow:\s*\/(checkout|account|admin)/);
  });

  test('the sitemap index is valid XML and lists children', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/sitemap-index.xml`);
    const body = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    expect(body).toContain('<sitemapindex');
    expect(body).toContain('<loc>');
  });

  test('checkout and account pages are noindex', async ({ shopper }) => {
    for (const path of ['/checkout', '/account', '/cart']) {
      await shopper.goto(path);

      const robots = await shopper
        .locator('meta[name="robots"]')
        .first()
        .getAttribute('content')
        .catch(() => null);

      expect(robots, `${path} is missing a robots meta tag`).toContain('noindex');
    }
  });

  test('a missing product returns a real 404, not a soft one', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/shop/definitely-not-a-real-product-slug`, {
      failOnStatusCode: false,
    });

    /*
     * A "not found" page served with a 200 is a soft 404. Google indexes it,
     * then reports thousands of duplicates — and every one of them dilutes the
     * pages that should rank.
     */
    expect(response.status()).toBe(404);
  });
});
