# Troubleshooting

Symptom first, because that is what you have at 3am.

---

## Triage, in order

1. `curl -s https://example.com/api/health` — is the Worker running?
2. `/api/health/deep` (signed in as an admin) — which subsystem is degraded?
3. Sentry, last hour, filtered to `production`.
4. `wrangler tail --env production --status error`.
5. Status pages: [Cloudflare](https://www.cloudflarestatus.com),
   [Neon](https://neonstatus.com), [Upstash](https://status.upstash.com),
   [Klarna](https://status.klarna.com), [Resend](https://resend-status.com).
6. Did we deploy? `wrangler deployments list --env production`.

If step 6 is yes and steps 3–5 are unhelpful, roll back first and diagnose after.
`wrangler rollback --env production` is seconds and reverts the Worker only.

---

## Deployment

### `EPERM: operation not permitted, symlink` during `cf:build` (Windows)

Not a code problem. OpenNext's bundler symlinks traced `node_modules` into
`.open-next/`, and Windows refuses to create symlinks unless the process is
elevated or **Developer Mode** is on.

```
Settings → System → For developers → Developer Mode: On
```

Then restart the terminal. Without it, `npm run build` still works — the failure
is only in the OpenNext bundling step that follows — so a Windows developer can
work normally and let CI produce the deployable bundle. CI runs on Linux, where
symlinks are unrestricted.

Confirm which side of the line you are on:

```bash
node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'s-'));try{fs.symlinkSync(d,p.join(d,'l'),'dir');console.log('ALLOWED')}catch(e){console.log('DENIED',e.code)}"
```

### `Node.js middleware is not currently supported`

The edge auth filter has been renamed to `proxy.ts`, or otherwise moved to the
Node runtime. It must stay `src/middleware.ts` — see the header of that file.
Next 16's `proxy.ts` is Node-only and cannot be declared as edge, and a
Cloudflare Worker _is_ the edge runtime, so a Node proxy has nowhere to run.

### `Cannot find module '../.open-next/worker.js'`

The OpenNext build has not run. `npm run cf:build` before `wrangler deploy`, or
just use `npm run cf:deploy`, which does both.

### `Durable Object class not found`

`cloudflare/worker.ts` is not re-exporting `DOQueueHandler` and
`DOShardedTagCache`. Wrangler resolves `durable_objects.bindings` against the
classes exported by `main`, and `main` is the wrapper, not the generated worker.

### `Script startup exceeded CPU time limit`

Something heavy is running at module scope. Move it inside a handler or behind a
lazy import — a `new PrismaClient()` or a large JSON parse at the top level runs
on every cold start, and the startup budget is far smaller than the request one.

### `Queue not found`

Created in the wrong account, or the name in `wrangler.jsonc` does not match.
`wrangler queues list`. Note the dead-letter queues must exist _before_ the
queues referencing them.

### Deploy succeeds, site 500s immediately

Almost always a missing secret. `wrangler secret list --env production` and
compare against [environment.md](./environment.md). `npm run verify:production`
against the same variables says which one.

---

## Database

### `Can't reach database server`

- Neon compute suspended — autosuspend must be **disabled** in production, see
  [neon.md](./neon.md#autoscaling-and-autosuspend).
- `DATABASE_URL` missing `?sslmode=require`.
- Using the direct host at runtime instead of the pooled one.

### `too many connections`

Not using the pooler. `DATABASE_URL` must contain `-pooler`. Every isolate opens
its own connection, and hundreds of isolates exhaust Postgres outright — the
symptom appears at exactly the moment traffic succeeds.

Also set `connection_limit=1`: Prisma's own pool inside an isolate is pointless,
and a pool of ten means ten idle connections held per isolate.

### Migration hangs

Running through the pooler. Prisma takes a session-level advisory lock, and
PgBouncer in transaction mode releases it between statements — so it protects
nothing and two deploys deadlock. Use `DIRECT_DATABASE_URL`.

To clear a stuck lock:

```sql
SELECT pg_advisory_unlock_all();
SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
```

A row with `finished_at IS NULL` and `rolled_back_at IS NULL` is the one that
hung. Decide whether it applied, then `prisma migrate resolve --applied` or
`--rolled-back`.

### `The migration was modified after it was applied`

An applied migration was edited. Prisma checksums them. Restore the original
file from git and write a _new_ migration for the change.

### Slow queries after a deploy

```sql
SELECT calls, round(total_exec_time::numeric) AS total_ms, query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

Usually a new query with no index, or an `include` that became N+1.

---

## Payments

Full table in [klarna.md](./klarna.md#common-failures). The three that recur:

### Widget renders, authorise fails

CSP is missing `*.klarna.com` in `connect-src`. The widget mounts because
`script-src` allows the SDK, then its own API call is blocked — so it looks like
a decline rather than a configuration problem.

### Widget never appears

**Rocket Loader is on.** It reorders script execution and breaks the SDK's
mounting. The symptom is intermittent and nearly impossible to reproduce. Turn
it off in Cloudflare → Speed → Optimization.

### Orders stuck in `PENDING` with a Klarna order id

Push notifications are not arriving. Check:

1. The notification URL in the Merchant Portal points at the right environment.
2. `KLARNA_WEBHOOK_SECRET` matches what is in that URL.
3. The Klarna egress WAF rule is not blocking a range that has changed.

Meanwhile, reconcile by hand — `syncFromKlarna(klarnaOrderId)` re-reads from
Klarna and fixes the order. The nightly job does this anyway; the webhook is the
fast path, not the only one.

### `Capture failed: NOT_ALLOWED`

The authorisation expired. Check the `0 6 * * *` cron trigger is running and
that `extendExpiringAuthorizations` is not erroring — an expired authorisation
cannot be captured and the revenue is gone.

---

## Cache and rate limiting

### Rate limits not applying

`/api/health/deep` → `cache.driver`. If it says `memory`, Upstash is
unconfigured and limits are per-isolate — which on Workers is no limit at all.

### `ratelimit.store_unavailable` in the logs

Upstash is unreachable and the limiter is **failing open**. Deliberate:
rejecting everything would turn an Upstash blip into a full site outage, and
Cloudflare's WAF is still in front. But it is a real degradation and worth an
alert.

### Stale content after an edit

Three cache layers, and they are cleared separately:

| Layer                           | Cleared by                         |
| ------------------------------- | ---------------------------------- |
| Upstash (`lib/cache/store.ts`)  | `invalidate(tag)`                  |
| Next incremental (R2 + KV + DO) | `revalidateTag` / `revalidatePath` |
| Cloudflare edge                 | The purge API                      |

`revalidateTag` does not clear Upstash. `invalidate` does not clear the edge.
Clearing the wrong one and concluding "caching is broken" costs an afternoon.

Never `purge_everything` on a live site — it cold-starts every page at once and
the stampede hits the database far harder than the stale content ever did.

---

## Background jobs

### Nothing runs

1. `/api/health/deep` → `queue.oldestQueuedSeconds`. Large means nothing is
   draining.
2. `queue.pushDelivery` says `cron-sweep-only`? Expected in dev and CI; in
   production it means the queue binding is missing.
3. Is the `* * * * *` cron trigger firing? Cloudflare dashboard → Workers →
   Triggers.
4. `CRON_SECRET` unset makes `/api/cron/*` refuse everything, by design.

### A job runs twice

Expected, and the handler must tolerate it. Cloudflare Queues is at-least-once,
`reclaimStale` returns jobs from crashed workers, and the sweep can race a queue
message. If a job is _not_ idempotent, that is the bug.

### Dead-letter queue filling

The Cloudflare DLQ is _delivery_ failure — the consumer crashed or OOMed. Check
Worker errors, not job payloads. Jobs whose _work_ failed are `JobStatus.DEAD`
in `/admin/jobs` with a readable `lastError`.

---

## Email

### Everything lands in spam

Almost always the DKIM record. It must be **DNS-only**, not proxied — proxying
hides it behind Cloudflare's IPs and verification fails.

```bash
dig CNAME resend._domainkey.yoassoc.com +short
```

Then send to Gmail and check **Show original** for SPF, DKIM and DMARC all
passing. Two SPF records is also treated as none; merge them.

### Nothing sends at all

`RESEND_API_KEY` unset means `sendEmail` logs and returns `{ ok: false }`. By
design, so a fresh clone runs — and reported by `npm run verify:production`.

### Bounces are not suppressed

The Resend webhook is not configured or its signature is failing. `wrangler tail
--search resend` — `resend.webhook_rejected` with `reason: stale` means clock
skew or a replayed request; `bad-signature` means the wrong secret.

---

## Performance

### LCP regressed

1. `npm run lighthouse` for the numbers.
2. Check `sizes` on the hero image. Wrong `sizes` downloads a 1920px image for a
   320px slot, and it looks fine in every screenshot.
3. Cloudflare cache hit rate for `/shop` — a miss means a full render.
4. Bundle size in the CI step summary.

### CPU time exceeded (Cloudflare error 1102)

A request doing more work than the budget allows. It fails hard rather than
slowly. Usually: a large JSON parse, an unbounded loop over a query result, or
rendering a page with several thousand items because a `take` was dropped.

### Everything is slow, database is fine

Check the Upstash region. A cache in a different continent from the compute adds
a round trip to every cached read — a "cache" that costs more than the query.

---

## Getting more detail

```bash
wrangler tail --env production --format pretty
wrangler tail --env production --status error
wrangler tail --env production --search "order_id"

wrangler deployments list --env production
wrangler secret list --env production
wrangler queues list

curl -s https://example.com/api/health | jq
curl -sI https://example.com/ | grep -i cf-cache-status
```

For a customer-reported problem, ask for the **error reference** shown on the
error page — that is the Sentry event id from `X-Error-Id`, and it goes straight
into Sentry's search.
