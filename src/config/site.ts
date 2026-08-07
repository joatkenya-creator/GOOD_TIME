import { publicEnv } from '@/lib/env.public';

/**
 * Single source of truth for brand identity. Anything that would otherwise be
 * hard-coded into a page title, an email footer or a JSON-LD block lives here.
 */
export const siteConfig = {
  name: 'INTIMATE BUNNIE',
  legalName: 'Intimate Bunnie Commerce, Inc.',
  tagline: 'Body-safe toys, built to last.',
  description:
    'A premium sex toy shop for adults in the US. Body-safe silicone, glass and steel, rechargeable motors, honest specs and plain packaging — no jelly, no mystery materials, no euphemisms.',
  url: publicEnv.NEXT_PUBLIC_SITE_URL,
  locale: 'en-US',
  currency: 'USD',
  country: 'US',
  themeColor: '#E91E63',

  contact: {
    email: 'support@intimatebunnie.example',
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

  /**
   * Storefront is 18+. Drives the age gate and the `Product.isAdultOnly` default.
   *
   * This is a legal adult-products retailer: every listing is age-restricted, and
   * the age statement must appear in the footer and at checkout.
   */
  minimumAge: 18,
} as const;

export type SiteConfig = typeof siteConfig;
