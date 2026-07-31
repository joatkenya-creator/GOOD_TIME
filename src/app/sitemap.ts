import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo/url';
import { listCategoryPaths, listCollections } from '@/services/category.service';
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

  const [categories, collections, products] = await Promise.all([
    listCategoryPaths(),
    listCollections(),
    listProductSlugs(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/shop'), lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    {
      url: absoluteUrl('/collections'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    { url: absoluteUrl('/brands'), lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: absoluteUrl('/guides'), lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ];

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

    ...collections.map((collection) => ({
      url: absoluteUrl(`/collections/${collection.slug}`),
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),

    ...products.map((product) => ({
      url: absoluteUrl(productHref(product.primaryCategory?.path, product.slug)),
      lastModified: product.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
