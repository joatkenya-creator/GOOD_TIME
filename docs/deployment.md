# Deployment

The application runs on **Cloudflare Workers**, built by the **OpenNext**
Cloudflare adapter. This is the guide for getting it there the first time and
for every deploy afterwards.

---

## What actually runs

```
                    ┌──────────────────────────────────┐
   visitor ───────► │  Cloudflare edge                 │
                    │  DNS · TLS · WAF · Bot · Cache   │
                    └────────────┬─────────────────────┘
                                 │ cache miss
                    ┌────────────▼─────────────────────┐
                    │  Worker: good-time-production    │
                    │  cloudflare/worker.ts            │
                    │    fetch     → OpenNext / Next   │
                    │    queue     → background jobs   │
                    │    scheduled → cron triggers     │
                    └──┬────────┬────────┬─────────┬───┘
                       │        │        │         │
             ┌─────────▼──┐  ┌──▼─────┐ ┌▼──────┐ ┌▼──────────┐
             │ Neon       │  │Upstash │ │ R2+KV │ │ Queues    │
             │ Postgres   │  │ Redis  │ │ +DO   │ │ jobs/email│
             │ (pooled)   │  │ cache  │ │ ISR   │ │ + DLQ     │
             └────────────┘  └────────┘ └───────┘ └───────────┘
                       │
             ┌─────────▼──────────────────────────────────────┐
             │ Klarna · Resend · Cloudinary · Sentry · TaxJar │
             └───────────────────────────────────────────────┘
```

The Worker is one script. `fetch` serves HTTP through OpenNext; `queue` runs
background jobs pushed by Cloudflare Queues; `scheduled` handles cron triggers.
All three are in [`cloudflare/worker.ts`](../cloudflare/worker.ts), which wraps
the generated OpenNext output because `queue` and `scheduled` are Worker-level
exports that no adapter option can add.

---

## One-time setup

### 1. Cloudflare account

```bash
npm i -g wrangler          # or use npx wrangler throughout
wrangler login
wrangler whoami            # note the account id
```

### 2. Create the storage the Worker binds to

Names must match [`wrangler.jsonc`](../wrangler.jsonc). Create both
environments — staging must be incapable of writing to production storage.

```bash
# Incremental cache (ISR / unstable_cache page output)
wrangler r2 bucket create good-time-cache
wrangler r2 bucket create good-time-cache-staging

# Tag index for revalidateTag / revalidatePath
wrangler kv namespace create NEXT_TAG_CACHE_KV
wrangler kv namespace create NEXT_TAG_CACHE_KV --env staging
```

Both `kv namespace create` commands print an `id`. Paste each into the matching
`kv_namespaces` entry in `wrangler.jsonc`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID` and `REPLACE_WITH_STAGING_KV_ID`. This is the one
value the config cannot know in advance.

### 3. Create the queues

Dead-letter queues must exist **before** the queues that reference them, or the
create fails with a message that does not say so.

```bash
wrangler queues create good-time-jobs-dlq
wrangler queues create good-time-email-dlq

wrangler queues create good-time-jobs
wrangler queues create good-time-email
wrangler queues create good-time-jobs-staging
wrangler queues create good-time-email-staging
```

### 4. Set the secrets

Never in `wrangler.jsonc`. `vars` is committed to git; a secret there survives
in history forever.

```bash
# Repeat for --env staging with the staging values.
for KEY in DATABASE_URL DIRECT_DATABASE_URL AUTH_SECRET \
           KLARNA_USERNAME KLARNA_PASSWORD KLARNA_WEBHOOK_SECRET \
           RESEND_API_KEY RESEND_WEBHOOK_SECRET \
           CLOUDINARY_API_KEY CLOUDINARY_API_SECRET \
           UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN \
           SENTRY_DSN TURNSTILE_SECRET_KEY CRON_SECRET TAXJAR_API_KEY; do
  wrangler secret put "$KEY" --env production
done
```

The full table of what each one is, whether it is secret, and how to rotate it
is in [environment.md](./environment.md).

### 5. Custom domains

`wrangler.jsonc` declares `example.com` and `www.example.com` as
`custom_domain` routes. Replace those with the real hostnames, then:

```bash
npm run cf:deploy
```

Wrangler provisions the DNS records and the certificate. Verify with
[cloudflare.md](./cloudflare.md#dns) before pointing the registrar's
nameservers.

---

## Deploying

### Locally

```bash
npm run cf:build            # next build + OpenNext transform
npm run cf:preview          # runs it in workerd, with real bindings
```

`cf:preview` is the only local mode that exercises the actual runtime. `npm run
dev` is Next's dev server with Cloudflare bindings injected (see the bottom of
[`next.config.ts`](../next.config.ts)) — close, but not workerd. **Test anything
that touches a binding, a queue or a Durable Object under `cf:preview` before
deploying it.**

> **On Windows**, `cf:build` fails with `EPERM: operation not permitted,
symlink` unless Developer Mode is enabled. `npm run build` still works, so
> ordinary development is unaffected — but the deployable bundle has to come
> from CI or from a machine with symlinks permitted. See
> [troubleshooting.md](./troubleshooting.md#deployment).

```bash
npm run cf:deploy:staging
npm run cf:deploy           # production
```

### Through CI

The normal path, and the only one that also runs migrations and uploads source
maps.

- **Push to `main`** → [`deploy.yml`](../.github/workflows/deploy.yml) deploys
  staging automatically.
- **Production** → `workflow_dispatch` with `environment: production`, gated on
  the `production` GitHub Environment's required reviewers.

Production deploys are deliberately manual. A deploy that takes payments should
be a decision somebody made, at a time somebody chose, with somebody available
to roll it back.

The production job, in order:

1. `npm run verify:production` — refuses to deploy a half-configured environment
2. Neon branch snapshot — the restore point
3. `prisma migrate deploy` over the **unpooled** connection
4. `npm run cf:build`
5. Source maps to Sentry, then deleted from the assets
6. `wrangler deploy --env production`
7. Smoke test: health, home, robots, sitemap, HSTS, CSP
8. Automatic `wrangler rollback` if the smoke test fails

---

## Rolling back

```bash
wrangler deployments list --env production
wrangler rollback --env production --message "reverting <sha>"
```

Instant — it repoints traffic at a version already on the edge.

**It reverts the Worker only.** Migrations that have applied stay applied. That
is why migrations here are expand-only: never drop a column in the same release
that stops writing to it. See [prisma.md](./prisma.md#rollback).

If a migration itself is the problem, restore from the Neon branch the deploy
created — [disaster-recovery.md](./disaster-recovery.md).

---

## Things that behave differently on Workers

Worth knowing before debugging something that works locally.

|                                | Node (`next start`)    | Workers                                                              |
| ------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| **Raw TCP**                    | yes                    | **no** — this is why Upstash is REST and Prisma uses the Neon pooler |
| **Background promises**        | run after the response | **frozen** — use `ctx.waitUntil` or `await`                          |
| **`setTimeout` past response** | works                  | not guaranteed                                                       |
| **Node builtins**              | all                    | only under `nodejs_compat`, and not all                              |
| **CPU budget**                 | none                   | metered; this is what you pay for                                    |
| **Global state**               | one process            | per isolate — never a cache, never a counter                         |

The last one is the trap. An in-memory counter is correct on one Node process
and meaningless across hundreds of isolates. That is precisely why
[rate limiting moved to Upstash](../src/lib/security/rate-limit.ts).

---

## Verifying a deploy

```bash
curl -sI https://example.com/ | grep -iE 'strict-transport|content-security|cf-cache-status'
curl -s  https://example.com/api/health
npm run verify:links                      # BASE_URL=https://example.com
npm run lighthouse                        # BASE_URL=https://example.com
wrangler tail --env production --format pretty
```

The full pre-launch list is [go-live.md](./go-live.md).

---

## See also

- [cloudflare.md](./cloudflare.md) — DNS, WAF, cache rules, firewall
- [neon.md](./neon.md) — database setup and connection strings
- [queues.md](./queues.md) — background processing
- [monitoring.md](./monitoring.md) — Sentry, logs, alerts
- [troubleshooting.md](./troubleshooting.md) — when a deploy goes wrong
