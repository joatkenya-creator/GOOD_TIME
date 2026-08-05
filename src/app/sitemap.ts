import type { MetadataRoute } from 'next';

import { LEGAL_SLUGS } from '@/features/legal/documents';
import { absoluteUrl } from '@/lib/seo/url';
import { listPageSlugs, listPostSlugs } from '@/services/blog.service';
import { listBrands, listCategoryPaths, listCollections } from '@/services/category.service';
import { listProductSlugs, productHref } from '@/services/product.service';

/**
 * `/sitemap.xml`.
 *
 * Static routes, every live category, every collection and every product, at the
 * same canonical URLs the pages themselves declare — a sitemap that disagrees
 * with the canonical tags is worse than no sitemap.
 *
 * Product URLs are built with `productHref`, the same helper the pages and the
 * API use, so the three can never drift apart.
 *
 * At 100k products this must switch to Next's `generateSitemaps` and emit chunks
 * of 5,000 URLs (`seoConfig.sitemap.maxUrlsPerChunk`); a single sitemap exceeds
 * Google's 50k-URL limit and the function's memory budget. The `listProductSlugs`
 * cap is what keeps the current single file honest rather than silently truncating.
 */
export const revalidate = 86_400; // 24h

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [categories, products, collections, brands, posts, cmsPages] = await Promise.all([
    listCategoryPaths(),
    listProductSlugs(),
    listCollections(),
    listBrands(),
    listPostSlugs(),
    listPageSlugs(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/shop'), lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    {
      url: absoluteUrl('/collections'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    { url: absoluteUrl('/brands'), lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: absoluteUrl('/guides'), lastModified: now, changeFrequency: 'weekly', priority: 0.6 },

    // Low priority, but listed: a shopper checking whether a retailer is
    // trustworthy often reads these before anything else.
    ...LEGAL_SLUGS.map((slug) => ({
      url: absoluteUrl(`/pages/${slug}`),
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];

  /*
   * `/collections`, `/brands` and `/guides` are listed again.
   *
   * They were removed when the sitemap was found to be publishing a list of
   * 404s — the routes did not exist, and asking a crawler to index them costs
   * crawl budget and reads as a low-quality site. The note left behind said
   * they go back in when the pages do. The pages exist now, so they do.
   *
   * `verify:quality` fetches every URL the sitemap publishes, so the next one
   * to drift fails the build rather than shipping.
   */

  return [
    ...staticRoutes,

    ...categories.map((category) => ({
      url: absoluteUrl(`/shop${category.path}`),
      lastModified: category.updatedAt,
      changeFrequency: 'daily' as const,
      // Deeper categories are more specific and convert better, but have less
      // authority to distribute. Shallow beats deep.
      priority: category.path.split('/').filter(Boolean).length === 1 ? 0.8 : 0.7,
    })),

    ...products.map((product) => ({
      url: absoluteUrl(productHref(product.primaryCategory?.path, product.slug)),
      lastModified: product.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),

    // Merchandised edits change more often than the categories they cut across.
    ...collections.map((collection) => ({
      url: absoluteUrl(`/collections/${collection.slug}`),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),

    ...brands.map((brand) => ({
      url: absoluteUrl(`/brands/${brand.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),

    /*
     * Editorial earns the informational searches product pages cannot, so it is
     * worth more than its transactional priority suggests.
     */
    ...posts.map((post) => ({
      url: absoluteUrl(`/guides/${post.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),

    /*
     * Admin-authored pages — shipping, returns, warranty and the rest of the
     * footer. Low priority, but a shopper deciding whether a retailer is
     * trustworthy often reads these before anything else.
     */
    ...cmsPages.map((page) => ({
      url: absoluteUrl(`/pages/${page.slug}`),
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.3,
    })),
  ];
}
