import { z } from 'zod';

/**
 * Client-visible environment.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when referenced
 * statically, so every key is spelled out below — do not refactor this into a loop.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: z.string().optional(),
  NEXT_PUBLIC_CLARITY_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string().optional(),

  /**
   * Klarna has no publishable key: the widget is mounted with a per-session
   * client token fetched from our own API. Only the environment name reaches
   * the browser, so the SDK loads the matching playground or live assets.
   */
  NEXT_PUBLIC_KLARNA_ENVIRONMENT: z.enum(['playground', 'production']).default('playground'),

  /** Turnstile site key — public by design; the secret stays server-side. */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  /**
   * Sentry's browser DSN. Public by design — a DSN can submit events and read
   * nothing — but scoped to a separate client-side project key so a flood of
   * browser noise cannot drown the server events.
   */
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

/**
 * The advertising and analytics tags — GA4, GTM, Google Ads, Meta, TikTok,
 * Pinterest, Clarity — are configured in the admin, not here. See
 * `services/marketing/integrations.ts`: their ids are data, they change without
 * a deploy, and they are gated on consent at render time.
 */

/** An unset variable in a `.env` file arrives as `''`; treat that as absent. */
const orAbsent = (value: string | undefined) => (value === '' ? undefined : value);

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: orAbsent(process.env.NEXT_PUBLIC_SITE_URL),
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: orAbsent(process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID),
  NEXT_PUBLIC_CLARITY_PROJECT_ID: orAbsent(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID),
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: orAbsent(process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME),
  NEXT_PUBLIC_KLARNA_ENVIRONMENT: orAbsent(process.env.NEXT_PUBLIC_KLARNA_ENVIRONMENT),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: orAbsent(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  NEXT_PUBLIC_SENTRY_DSN: orAbsent(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

export type PublicEnv = z.infer<typeof publicSchema>;
