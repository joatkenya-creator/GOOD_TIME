import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

import { securityHeaders } from './src/lib/security/headers';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Pin the workspace root: without it Turbopack walks up and can pick a
  // lockfile from a parent directory as the project root.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },

  // Fail the production build on type errors — never ship a red build.
  // Linting runs in CI (`npm run lint`) rather than in the build, so a style
  // violation does not block a hotfix deploy.
  typescript: { ignoreBuildErrors: false },

  images: {
    // Cloudinary is the only remote source we serve product media from.
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' }],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [64, 96, 128, 192, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  experimental: {
    // Trims client bundles by importing only the icons/components actually used.
    optimizePackageImports: ['lucide-react', 'framer-motion', '@tanstack/react-query'],
  },

  /**
   * Emits browser source maps in the production build.
   *
   * Without them a Sentry stack trace from a customer's browser reads
   * `chunk-4f2a.js:1:88214`, which localises a bug to "somewhere in the
   * bundle". The maps are uploaded to Sentry and to Cloudflare
   * (`upload_source_maps` in wrangler.jsonc) rather than served publicly — the
   * `.map` files are stripped from the deployed assets by the CI step in
   * `.github/workflows/deploy.yml`.
   */
  productionBrowserSourceMaps: true,

  /**
   * Compression is Cloudflare's job, not the Worker's.
   *
   * Cloudflare applies Brotli at the edge to every eligible response. Gzipping
   * inside the isolate would burn CPU-ms — which is what a Worker is billed on
   * — to produce a worse-compressed body that then gets recompressed anyway.
   */
  compress: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default config;

/**
 * Makes Cloudflare bindings — R2, KV, Queues, Durable Objects — available under
 * `next dev`.
 *
 * Without this, `getCloudflareContext()` returns nothing locally and every
 * binding silently falls back: the cache goes in-process, jobs run only on the
 * cron sweep. That is a *working* application, which is exactly the problem —
 * "works in dev, behaves differently in production" is how binding bugs reach
 * customers.
 *
 * ## Why the import is static and the call is not awaited
 *
 * Next compiles `next.config.ts` to CommonJS, and CommonJS cannot `require()` a
 * module graph containing a top-level `await`. Both the documented
 * `await import(...)` and a top-level `await` on the call itself fail the build
 * outright with `ERR_REQUIRE_ASYNC_MODULE`.
 *
 * So: a static import, and the promise is deliberately floated. It resolves
 * during dev-server startup, well before the first request can arrive, and the
 * guard means neither the call nor its cost exists in a production build.
 */
if (process.env.NODE_ENV === 'development') {
  void initOpenNextCloudflareForDev();
}
