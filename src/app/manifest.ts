import type { MetadataRoute } from 'next';

import { siteConfig } from '@/config/site';

/** PWA manifest. Also what Android uses for the "add to home screen" entry. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: siteConfig.themeColor,

    /**
     * Intentionally empty until real brand assets exist.
     *
     * A manifest that lists icons which 404 makes Chrome log a download error on
     * every page load, and an install prompt with a broken icon is worse than no
     * install prompt. The tab icon is covered by the generated `app/icon.tsx`.
     *
     * To enable installability, drop these into `public/icons/` and list them here:
     *   icon-192.png (192x192), icon-512.png (512x512),
     *   icon-maskable-512.png (512x512, purpose: 'maskable', ~10% safe-zone padding)
     */
    icons: [],
  };
}
