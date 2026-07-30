import type { MetadataRoute } from 'next';

import { seoConfig } from '@/config/seo';
import { absoluteUrl } from '@/lib/seo/url';

/**
 * `/robots.txt`.
 *
 * Blocks the transactional and personal surfaces — cart, checkout, account,
 * admin — which have no search value and would otherwise burn crawl budget that
 * belongs to product pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...seoConfig.disallowedPaths],
      },
      {
        // Cart-abandonment and price scrapers add load without adding customers.
        userAgent: ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot'],
        disallow: '/',
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
