import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo/url';

/**
 * `/sitemap.xml`.
 *
 * Phase 1 emits the static routes only. Once the catalogue exists, this file
 * switches to Next's `generateSitemaps` and returns one chunk per 5,000 URLs —
 * `seoConfig.sitemap.maxUrlsPerChunk` — because a single sitemap listing 100k
 * products would exceed Google's 50MB/50k-URL limit and time out on generation.
 *
 * The chunked version must page through the database with a cursor, not
 * `findMany({ take: 100000 })`, which would not fit in a serverless function's
 * memory budget.
 */
/** Segment config must be a literal — Next reads it statically, before evaluation. */
export const revalidate = 86_400; // 24h

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
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
}
