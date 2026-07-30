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

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default config;
