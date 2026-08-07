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

  // --- Payments: Klarna ----------------------------------------------------
  /**
   * API credentials from the Klarna Merchant Portal → Settings → Klarna API
   * credentials. The username looks like `PK12345_1a2b3c4d`, not an email.
   * Playground and production are separate accounts with separate credentials.
   */
  KLARNA_USERNAME: z.string().optional(),
  KLARNA_PASSWORD: z.string().optional(),
  /** Which Klarna API host to talk to. Getting this wrong 404s every request. */
  KLARNA_REGION: z.enum(['eu', 'na', 'oc']).default('na'),
  KLARNA_ENVIRONMENT: z.enum(['playground', 'production']).default('playground'),
  /**
   * Unguessable secret embedded in the notification URL handed to Klarna.
   * Klarna does not sign its pushes, so this is the only thing keeping the
   * endpoint from being an open trigger. Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   */
  KLARNA_WEBHOOK_SECRET: z.string().min(32).optional(),

  // --- Email --------------------------------------------------------------
  RESEND_API_KEY: z.string().startsWith('re_').optional(),
  /** Verifies inbound Resend webhooks (bounces, complaints). Svix-signed. */
  RESEND_WEBHOOK_SECRET: z.string().optional(),
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
    .default('INTIMATE BUNNIE <no-reply@example.com>'),
  /** Where customer replies land. Never the no-reply sender. */
  EMAIL_REPLY_TO: z.email().optional(),

  // --- Tax ----------------------------------------------------------------
  /**
   * Which implementation `quoteTax` uses.
   *
   * Defaults to `table`, so an unconfigured deployment charges the estimate and
   * says so rather than silently charging nothing.
   */
  TAX_PROVIDER: z.enum(['table', 'taxjar']).default('table'),
  TAXJAR_API_KEY: z.string().optional(),

  /**
   * Ship-from address. Required by any provider: US sourcing rules mean the
   * origin decides the rate in ~11 origin-sourced states, and the destination
   * decides it everywhere else.
   */
  SHIP_FROM_COUNTRY: z.string().length(2).default('US'),
  SHIP_FROM_STATE: z.string().length(2).optional(),
  SHIP_FROM_CITY: z.string().optional(),
  SHIP_FROM_STREET: z.string().optional(),
  SHIP_FROM_ZIP: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, 'Must be a 5- or 9-digit ZIP')
    .optional(),

  // --- Media (scaffold only) ----------------------------------------------
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // --- Operations ---------------------------------------------------------
  /** Requests per window per identity for the default rate-limit bucket. */
  GOOGLE_SITE_VERIFICATION: z.string().optional(),
  /**
   * Shared secret for `/api/cron/*`.
   *
   * Vercel Cron sends it as `Authorization: Bearer`. Unset means the endpoints
   * refuse every request — a scheduled job that anyone can trigger is a denial of
   * service with extra steps.
   */
  CRON_SECRET: z.string().min(16).optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Cache and rate-limit store: Upstash Redis ---------------------------
  /**
   * REST endpoint, not a `redis://` URL. The Workers runtime has no raw TCP, so
   * a redis:// client cannot connect from the edge at all — this is HTTP by
   * necessity, not preference.
   */
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // --- Observability ------------------------------------------------------
  /** Sentry DSN. Unset disables reporting entirely rather than buffering. */
  SENTRY_DSN: z.url().optional(),
  /** Tags every event, so a staging error is never mistaken for a live one. */
  SENTRY_ENVIRONMENT: z.string().default('development'),
  /** Deploy identifier — the git SHA in CI. Makes "when did this start" answerable. */
  SENTRY_RELEASE: z.string().optional(),
  /** 0–1. Full capture in production is affordable at this traffic level. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // --- Bot protection: Cloudflare Turnstile --------------------------------
  TURNSTILE_SECRET_KEY: z.string().optional(),
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
  klarna: Boolean(env.KLARNA_USERNAME && env.KLARNA_PASSWORD),
  resend: Boolean(env.RESEND_API_KEY),
  cloudinary: Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  ),
  googleOAuth: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  upstash: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
  sentry: Boolean(env.SENTRY_DSN),
  turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
} as const;

/**
 * Things that are optional in development and non-negotiable in production.
 *
 * Kept out of the Zod schema deliberately: making them `required` there breaks
 * `npm run dev` on a fresh clone, and making them optional there means a
 * production deploy silently boots with no payments and no rate limiting. This
 * splits the difference — the schema stays developer-friendly and the launch
 * gate is explicit, enumerated, and testable.
 *
 * Called by `/api/health/deep` and by the `verify:production` script rather
 * than at import time, so a misconfiguration is a red check in CI rather than
 * a crash loop with no logs.
 */
export interface ProductionReadiness {
  ready: boolean;
  missing: { key: string; why: string }[];
}

export function productionReadiness(): ProductionReadiness {
  const required: { key: string; present: boolean; why: string }[] = [
    { key: 'KLARNA_USERNAME', present: integrations.klarna, why: 'No payments can be taken.' },
    {
      key: 'KLARNA_WEBHOOK_SECRET',
      present: Boolean(env.KLARNA_WEBHOOK_SECRET),
      why: 'The Klarna notification endpoint would accept unauthenticated calls.',
    },
    {
      key: 'KLARNA_ENVIRONMENT',
      present: env.KLARNA_ENVIRONMENT === 'production',
      why: 'Still pointed at the Klarna playground — real cards will not work.',
    },
    { key: 'RESEND_API_KEY', present: integrations.resend, why: 'No receipts would be sent.' },
    {
      key: 'CLOUDINARY_API_SECRET',
      present: integrations.cloudinary,
      why: 'Product imagery cannot be uploaded or transformed.',
    },
    {
      key: 'UPSTASH_REDIS_REST_URL',
      present: integrations.upstash,
      why: 'Rate limits and cache become per-instance, so the effective limit is limit × instances.',
    },
    { key: 'SENTRY_DSN', present: integrations.sentry, why: 'Errors go nowhere a human will see.' },
    {
      key: 'CRON_SECRET',
      present: Boolean(env.CRON_SECRET),
      why: 'Scheduled endpoints refuse every request, so nothing is ever processed.',
    },
    {
      key: 'TAX_PROVIDER',
      present: env.TAX_PROVIDER !== 'table',
      why: 'Sales tax is an estimate, not an assessed amount. Do not take real orders on it.',
    },
    {
      key: 'DIRECT_DATABASE_URL',
      present: Boolean(env.DIRECT_DATABASE_URL),
      why: 'Migrations run through the pooler, where advisory locks do not survive.',
    },
  ];

  const missing = required.filter((item) => !item.present).map(({ key, why }) => ({ key, why }));

  return { ready: missing.length === 0, missing };
}
