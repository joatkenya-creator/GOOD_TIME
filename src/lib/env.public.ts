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
});

/** An unset variable in a `.env` file arrives as `''`; treat that as absent. */
const orAbsent = (value: string | undefined) => (value === '' ? undefined : value);

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: orAbsent(process.env.NEXT_PUBLIC_SITE_URL),
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: orAbsent(process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID),
  NEXT_PUBLIC_CLARITY_PROJECT_ID: orAbsent(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID),
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: orAbsent(process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME),
});

export type PublicEnv = z.infer<typeof publicSchema>;
