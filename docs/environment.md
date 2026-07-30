# Environment variables

Server variables are validated at boot by [`src/lib/env.ts`](../src/lib/env.ts);
client-visible ones by [`src/lib/env.public.ts`](../src/lib/env.public.ts). A
missing or malformed value fails the process with a list of exactly what is
wrong.

`NEXT_PUBLIC_*` variables are **inlined into the browser bundle**. Never put a
secret behind that prefix.

---

## Required

| Variable       | Format                                | Notes                                                      |
| -------------- | ------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://user:pass@host:port/db` | Use the **pooled** endpoint in production.                 |
| `AUTH_SECRET`  | ≥ 32 characters                       | `openssl rand -base64 32`. Rotating it signs everyone out. |

---

## Core

| Variable               | Default                      | Notes                                                                                                                     |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                | Set by the platform.                                                                                                      |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`      | Public. Drives canonical URLs, OG tags, sitemap, email links. **Must be the real production domain**, not `*.vercel.app`. |
| `DIRECT_DATABASE_URL`  | falls back to `DATABASE_URL` | Unpooled connection for migrations. Required when `DATABASE_URL` is a transaction pooler.                                 |

---

## Auth.js

| Variable             | Required | Notes                                                    |
| -------------------- | -------- | -------------------------------------------------------- |
| `AUTH_SECRET`        | yes      | See above.                                               |
| `AUTH_URL`           | no       | Canonical auth origin. Inferred on Vercel.               |
| `AUTH_TRUST_HOST`    | no       | `true` behind a trusted proxy (Vercel). Default `false`. |
| `AUTH_GOOGLE_ID`     | no       | Enables the Google button when set alongside the secret. |
| `AUTH_GOOGLE_SECRET` | no       | Both must be present, or neither.                        |

The Google provider is registered only when both values exist, so the sign-in
page never renders a button that cannot work.

---

## Stripe — scaffolded, not wired

| Variable                | Format    | Notes                                             |
| ----------------------- | --------- | ------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | `sk_…`    | Absent means Stripe calls return a clean 503.     |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | From the webhook endpoint, not the API keys page. |

---

## Resend — scaffolded, not wired

| Variable         | Format                            | Notes                                                 |
| ---------------- | --------------------------------- | ----------------------------------------------------- |
| `RESEND_API_KEY` | `re_…`                            | Absent: emails are logged, not sent, and never throw. |
| `EMAIL_FROM`     | `GOOD TIME <no-reply@domain.com>` | Domain must be verified in Resend.                    |

---

## Cloudinary — scaffolded, not wired

| Variable                            | Public | Notes                                               |
| ----------------------------------- | ------ | --------------------------------------------------- |
| `CLOUDINARY_CLOUD_NAME`             | no     | Signing.                                            |
| `CLOUDINARY_API_KEY`                | no     | Signing.                                            |
| `CLOUDINARY_API_SECRET`             | no     | **Secret.** Never expose.                           |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | yes    | Same value, for building delivery URLs client-side. |

All three server values must be set together; `integrations.cloudinary` gates on
the trio.

---

## Analytics

| Variable                         | Public | Notes                                               |
| -------------------------------- | ------ | --------------------------------------------------- |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | yes    | `G-XXXXXXXXXX`. Absent: no GA4 script is rendered.  |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | yes    | Absent: no Clarity script is rendered.              |
| `GOOGLE_SITE_VERIFICATION`       | no     | Search Console HTML-tag token. Absent: tag omitted. |

---

## Operations

| Variable                    | Default | Notes                                                          |
| --------------------------- | ------- | -------------------------------------------------------------- |
| `RATE_LIMIT_MAX`            | `60`    | Requests per window for the default bucket.                    |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`    | Window length.                                                 |
| `LOG_LEVEL`                 | `info`  | `debug` \| `info` \| `warn` \| `error`.                        |
| `SKIP_ENV_VALIDATION`       | `false` | Bypasses validation. **CI type-checks and image builds only.** |

Auth routes set their own tighter limits in code and ignore the defaults.

---

## Per-environment checklist

**Local** — `DATABASE_URL`, `AUTH_SECRET`. Everything else optional.

**Preview** — the above, plus `NEXT_PUBLIC_SITE_URL` pointed at the preview
domain, plus Stripe **test** keys if payments are being exercised.

**Production** — everything. Specifically verify:

- `NEXT_PUBLIC_SITE_URL` is the real domain (wrong value = wrong canonical URLs
  on every page, and broken links in every email);
- `DATABASE_URL` is pooled and `DIRECT_DATABASE_URL` is set;
- `AUTH_SECRET` differs from every other environment;
- Stripe keys are **live**, and the webhook secret matches the live endpoint;
- `EMAIL_FROM` uses a Resend-verified domain.
