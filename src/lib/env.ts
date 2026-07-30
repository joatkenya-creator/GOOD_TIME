import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Validated once at module load so a misconfigured deploy fails at boot with a
 * readable list of problems, rather than as a null-pointer three requests later.
 *
 * Rules:
 *   - anything secret lives here and is never re-exported to the client;
 *   - integrations that are only scaffolded are optional, so `npm run dev` works
 *     with nothing but a database URL;
 *   - client-visible values belong in `env.public.ts`.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Unpooled connection used by migrations when DATABASE_URL points at a pooler. */
  DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

  // --- Auth.js ------------------------------------------------------------
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_URL: z.url().optional(),
  AUTH_TRUST_HOST: z.stringbool().default(false),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  // --- Payments (scaffold only) -------------------------------------------
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  // --- Email (scaffold only) ----------------------------------------------
  RESEND_API_KEY: z.string().startsWith('re_').optional(),
  /**
   * Either `a@b.com` or the display-name form `Name <a@b.com>`. Resend accepts
   * both, and the display-name form is what customers should actually see.
   */
  EMAIL_FROM: z
    .string()
    .refine(
      (value) => z.email().safeParse(value.match(/<(.+)>/)?.[1] ?? value).success,
      'Must be an email address, optionally with a display name: "Name <a@b.com>"',
    )
    .default('GOOD TIME <no-reply@example.com>'),

  // --- Media (scaffold only) ----------------------------------------------
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- Operations ---------------------------------------------------------
  /** Requests per window per identity for the default rate-limit bucket. */
  GOOGLE_SITE_VERIFICATION: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * `.env` files spell an unset variable as `FOO=`, which dotenv loads as an empty
 * string rather than leaving it absent. Zod would then run `.startsWith('sk_')`
 * against `''` and reject it, so every commented-out integration in the template
 * would fail the boot check. Treat empty as absent, once, for every field.
 */
function withoutEmptyValues(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  ) as Record<string, string>;
}

function loadServerEnv(): ServerEnv {
  // `next build` runs this file in contexts where secrets are intentionally absent
  // (Docker image builds, CI type-checks). Opt out explicitly rather than by accident.
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    return process.env as unknown as ServerEnv;
  }

  const parsed = serverSchema.safeParse(withoutEmptyValues(process.env));

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}\n\nSee .env.example.`);
  }

  return parsed.data;
}

export const env = loadServerEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/** Integration availability — lets callers degrade gracefully instead of throwing. */
export const integrations = {
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  resend: Boolean(env.RESEND_API_KEY),
  cloudinary: Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  ),
  googleOAuth: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
} as const;
