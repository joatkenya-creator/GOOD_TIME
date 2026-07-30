import { publicEnv } from '@/lib/env.public';

/**
 * Single source of truth for brand identity. Anything that would otherwise be
 * hard-coded into a page title, an email footer or a JSON-LD block lives here.
 */
export const siteConfig = {
  name: 'GOOD TIME',
  legalName: 'Good Time Commerce, Inc.',
  tagline: 'Intimate wellness, thoughtfully made.',
  description:
    'A modern intimate wellness boutique — discreetly packaged, body-safe, and curated for grown-ups who care about quality.',
  url: publicEnv.NEXT_PUBLIC_SITE_URL,
  locale: 'en-US',
  currency: 'USD',
  country: 'US',
  themeColor: '#E91E63',

  contact: {
    email: 'support@goodtime.example',
    phone: '+1-800-000-0000',
    hours: 'Mon–Fri, 9am–6pm ET',
  },

  social: {
    instagram: 'https://instagram.com/',
    tiktok: 'https://tiktok.com/',
    pinterest: 'https://pinterest.com/',
  },

  /** Twitter/X handle used for `twitter:site`. Leave empty to omit the tag. */
  twitterHandle: '',

  /** Storefront is 18+. Drives the age gate and `isAdultOnly` defaults. */
  minimumAge: 18,
} as const;

export type SiteConfig = typeof siteConfig;
