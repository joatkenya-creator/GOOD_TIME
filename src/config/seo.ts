import { siteConfig } from '@/config/site';

/**
 * SEO defaults consumed by `src/lib/seo/*`. Page-level metadata is deliberately
 * NOT defined in phase 1 — only the machinery that will produce it.
 */
export const seoConfig = {
  titleTemplate: `%s | ${siteConfig.name}`,
  defaultTitle: `${siteConfig.name} — ${siteConfig.tagline}`,
  defaultDescription: siteConfig.description,
  defaultOgImage: '/og/default.png',
  ogImageSize: { width: 1200, height: 630 },

  /**
   * Paths that must never be indexed. Consumed by `app/robots.ts` and by the
   * metadata helper's `noindex` fallback.
   */
  disallowedPaths: [
    '/api/',
    '/admin',
    '/account',
    '/cart',
    '/checkout',
    '/sign-in',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/search',
  ],

  /** Sitemaps are chunked; Google caps a single sitemap at 50k URLs. */
  sitemap: {
    maxUrlsPerChunk: 5_000,
    defaultChangeFrequency: 'weekly',
  },

  /** Verification tokens rendered into <head>. Empty values are skipped. */
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION ?? '',
  },
} as const;
