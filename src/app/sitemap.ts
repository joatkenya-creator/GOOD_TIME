import type { MetadataRoute } from 'next';

import { LEGAL_SLUGS } from '@/features/legal/documents';
import { absoluteUrl } from '@/lib/seo/url';
import { listCategoryPaths } from '@/services/category.service';
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

  const [categories, products] = await Promise.all([listCategoryPaths(), listProductSlugs()]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/shop'), lastModified: now, changeFrequency: 'daily', priority: 0.9 },

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
   * `/collections`, `/brands` and `/guides` used to be listed here, along with a
   * URL per collection. None of those routes exist yet, so the sitemap was
   * handing search engines a list of 404s and asking them to index it — which
   * costs crawl budget and reads as a low-quality site. They go back in when the
   * pages do, not before. `verify:quality` now fetches every URL the sitemap
   * publishes, so the next one to drift fails the build instead of shipping.
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
  ];
}
