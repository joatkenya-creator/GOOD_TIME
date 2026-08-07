# Environment variables

Server variables are validated at boot by [`src/lib/env.ts`](../src/lib/env.ts);
client-visible ones by [`src/lib/env.public.ts`](../src/lib/env.public.ts). A
missing or malformed value fails the process with a list of exactly what is
wrong.

`NEXT_PUBLIC_*` variables are **inlined into the browser bundle**. Never put a
secret behind that prefix.

---

## Two tiers, on purpose

Only `DATABASE_URL` and `AUTH_SECRET` are required to run `npm run dev`.
Everything else degrades gracefully: the cache falls back to memory, emails log
instead of sending, payments refuse with a clear message.

That is deliberate — making them `required` in the Zod schema breaks a fresh
clone, a cost paid by every new contributor forever. Making them optional and
hoping means a production deploy boots happily with no payments, no rate
limiting and no error reporting, and nothing says so until a customer does.

So the launch gate is explicit and separate:

```bash
npm run verify:production
```

It enumerates what production requires and **why each one matters**, and exits
non-zero. It runs in the production deploy workflow before anything is built,
and is reported live at `/api/health/deep`. The list is `productionReadiness()`
in `env.ts`.

---

## Where values live

|                   | Development         | Staging / Production                  |
| ----------------- | ------------------- | ------------------------------------- |
| Secrets           | `.env` (gitignored) | `wrangler secret put KEY --env <env>` |
| Non-secret        | `.env`              | `vars` in `wrangler.jsonc`            |
| Build-time public | `.env`              | The `env:` block in `deploy.yml`      |

`NEXT_PUBLIC_*` values are baked in at **build** time, not read at runtime, so
they belong in the workflow's `env:` block rather than in `wrangler secret`. A
`wrangler secret` named `NEXT_PUBLIC_ANYTHING` does nothing at all — which is a
confusing half-hour the first time.

```bash
wrangler secret list --env production
wrangler secret put DATABASE_URL --env production
wrangler secret delete OLD_KEY --env production
```

---

## Required everywhere

| Variable       | Format           | Secret | Notes                                                     |
| -------------- | ---------------- | ------ | --------------------------------------------------------- |
| `DATABASE_URL` | `postgresql://…` | yes    | The **pooled** endpoint in production                     |
| `AUTH_SECRET`  | ≥ 32 chars       | yes    | `openssl rand -base64 32`. Rotating it signs everyone out |

## Core

| Variable               | Default                      | Secret | Notes                                                                                                             |
| ---------------------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                | no     | Set by the platform                                                                                               |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`      | no     | Drives canonical URLs, OG tags, the sitemap, email links and the Klarna notification URL. Must be the real domain |
| `DIRECT_DATABASE_URL`  | falls back to `DATABASE_URL` | yes    | Unpooled, for migrations. **Required in production** — see [neon.md](./neon.md#why-migrations-must-not)           |

## Auth.js

| Variable             | Required | Secret | Notes                                          |
| -------------------- | -------- | ------ | ---------------------------------------------- |
| `AUTH_SECRET`        | yes      | yes    |                                                |
| `AUTH_URL`           | no       | no     | Canonical auth origin                          |
| `AUTH_TRUST_HOST`    | no       | no     | `true` behind Cloudflare                       |
| `AUTH_GOOGLE_ID`     | no       | no     | Enables the Google button alongside the secret |
| `AUTH_GOOGLE_SECRET` | no       | yes    | Both, or neither                               |

## Klarna

| Variable                         | Required in production | Secret | Notes                                                |
| -------------------------------- | ---------------------- | ------ | ---------------------------------------------------- |
| `KLARNA_USERNAME`                | **yes**                | yes    | `PK12345_1a2b3c4d`, not an email                     |
| `KLARNA_PASSWORD`                | **yes**                | yes    | Shown once at generation                             |
| `KLARNA_REGION`                  | yes                    | no     | `na` / `eu` / `oc`. A wrong value 404s every request |
| `KLARNA_ENVIRONMENT`             | **yes**                | no     | Must be `production`; `verify:production` checks it  |
| `KLARNA_WEBHOOK_SECRET`          | **yes**                | yes    | ≥ 32 chars. Goes in the notification URL path        |
| `NEXT_PUBLIC_KLARNA_ENVIRONMENT` | yes                    | no     | Build-time                                           |

Playground and production are separate accounts. A playground credential against
the production host authenticates and then 404s.

## Tax

| Variable                              | Required in production | Secret | Notes                                                            |
| ------------------------------------- | ---------------------- | ------ | ---------------------------------------------------------------- |
| `TAX_PROVIDER`                        | **yes**                | no     | `table` charges an estimate. Must be `taxjar` before real orders |
| `TAXJAR_API_KEY`                      | with `taxjar`          | yes    |                                                                  |
| `SHIP_FROM_COUNTRY`                   | yes                    | no     | Default `US`                                                     |
| `SHIP_FROM_STATE`                     | yes                    | no     | Required by origin-sourced states                                |
| `SHIP_FROM_CITY` / `_STREET` / `_ZIP` | yes                    | no     |                                                                  |

## Email

| Variable                | Required in production | Secret | Notes                                                                        |
| ----------------------- | ---------------------- | ------ | ---------------------------------------------------------------------------- |
| `RESEND_API_KEY`        | **yes**                | yes    | Unset means emails log instead of sending                                    |
| `EMAIL_FROM`            | yes                    | no     | `INTIMATE BUNNIE <customercare@intimatebunnie.com>`. Domain must be verified |
| `EMAIL_REPLY_TO`        | yes                    | no     | A monitored, forwarded address — never a no-reply                            |
| `RESEND_WEBHOOK_SECRET` | yes                    | yes    | Svix-signed. Without it bounces are invisible                                |

## Cache and rate limiting

| Variable                    | Required in production | Secret | Notes                                         |
| --------------------------- | ---------------------- | ------ | --------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`    | **yes**                | no     | REST, not `redis://` — Workers has no raw TCP |
| `UPSTASH_REDIS_REST_TOKEN`  | **yes**                | yes    |                                               |
| `RATE_LIMIT_MAX`            | no                     | no     | Default 60                                    |
| `RATE_LIMIT_WINDOW_SECONDS` | no                     | no     | Default 60                                    |

Unset means limits are per-isolate, which on Workers is no limit at all.

## Media

| Variable                            | Required in production | Secret | Notes                       |
| ----------------------------------- | ---------------------- | ------ | --------------------------- |
| `CLOUDINARY_CLOUD_NAME`             | **yes**                | no     | Appears in every image URL  |
| `CLOUDINARY_API_KEY`                | **yes**                | no     |                             |
| `CLOUDINARY_API_SECRET`             | **yes**                | yes    | Signs uploads and deletions |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | yes                    | no     | Build-time                  |

## Monitoring

| Variable                    | Required in production | Secret | Notes                                            |
| --------------------------- | ---------------------- | ------ | ------------------------------------------------ |
| `SENTRY_DSN`                | **yes**                | yes\*  | \*It can only submit events, but treat it as one |
| `NEXT_PUBLIC_SENTRY_DSN`    | yes                    | no     | A **separate** browser project key               |
| `SENTRY_ENVIRONMENT`        | yes                    | no     | `production` / `staging`                         |
| `SENTRY_RELEASE`            | yes                    | no     | The git SHA, set by CI                           |
| `SENTRY_TRACES_SAMPLE_RATE` | no                     | no     | 0–1, default 0.1                                 |

## Bot protection

| Variable                         | Required in production | Secret | Notes                       |
| -------------------------------- | ---------------------- | ------ | --------------------------- |
| `TURNSTILE_SECRET_KEY`           | recommended            | yes    | Unconfigured means no check |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | recommended            | no     | Build-time                  |

## Operations

| Variable                   | Required in production | Secret | Notes                                                   |
| -------------------------- | ---------------------- | ------ | ------------------------------------------------------- |
| `CRON_SECRET`              | **yes**                | yes    | ≥ 16 chars. Unset makes `/api/cron/*` refuse everything |
| `LOG_LEVEL`                | no                     | no     | `debug` / `info` / `warn` / `error`                     |
| `GOOGLE_SITE_VERIFICATION` | no                     | no     | Search Console                                          |
| `SKIP_ENV_VALIDATION`      | no                     | no     | CI and image builds **only**                            |

## Analytics — not here

GA4, GTM, Google Ads, Meta, TikTok, Pinterest, Clarity and Cloudflare Web
Analytics are configured in the admin under **Marketing → Integrations**. Their
ids are public, they change without a deploy, and they are gated on consent at
render time. See
[`services/marketing/integrations.ts`](../src/services/marketing/integrations.ts).

---

## Rotation

| Variable                   | Cadence                 | Impact of rotating                                |
| -------------------------- | ----------------------- | ------------------------------------------------- |
| `AUTH_SECRET`              | yearly, or on suspicion | **Signs every user out.** Schedule it             |
| `KLARNA_PASSWORD`          | yearly                  | None if deployed atomically                       |
| `KLARNA_WEBHOOK_SECRET`    | yearly                  | Update the Merchant Portal URL in the same window |
| `RESEND_API_KEY`           | yearly                  | None                                              |
| `RESEND_WEBHOOK_SECRET`    | yearly                  | Svix accepts both keys during rotation            |
| `CLOUDINARY_API_SECRET`    | yearly                  | Invalidates in-flight upload signatures (1 hour)  |
| `UPSTASH_REDIS_REST_TOKEN` | yearly                  | Cache cold briefly; limits fail open in the gap   |
| `CRON_SECRET`              | yearly                  | Jobs pause until redeployed                       |
| `SENTRY_DSN`               | on suspicion            | Events go to a new project                        |
| Cloudflare API token       | quarterly               | CI fails until updated                            |
| Database password          | yearly                  | Update both URLs together                         |

### The procedure

1. Generate the new value. **Do not revoke the old one yet.**
2. `wrangler secret put KEY --env staging`, verify.
3. `wrangler secret put KEY --env production`, deploy, verify.
4. Revoke the old value at the provider.
5. Record the new value in the password manager.
6. Note the date.

Step 1 is the one people get wrong. Revoking first turns a routine rotation into
an outage, and there is no reason to — every provider here supports two live
credentials during a changeover.

**On a suspected leak, rotate first and investigate second.** Minutes to rotate;
potentially everything if the investigation concludes wrongly.

---

## Adding a variable

1. Add it to the Zod schema in `env.ts` (server) or `env.public.ts` (client),
   with a comment saying what it does and what happens without it.
2. Add it to `.env.example` with the same explanation.
3. Add a row to the table above, including whether it is secret.
4. If production genuinely needs it, add it to `productionReadiness()` with a
   `why` that names the consequence — "SENTRY_DSN missing" gets ignored, "errors
   go nowhere a human will see" does not.
5. If it is `NEXT_PUBLIC_*`, add it to the `env:` block in `deploy.yml`, because
   it is a build input rather than a runtime one.
