# Production architecture

The shape of the deployed system, and the reasoning behind each choice.
[architecture.md](./architecture.md) covers the application's internal layering;
this is everything outside it.

---

## The whole thing

```
                             ┌───────────────┐
                             │    visitor    │
                             └───────┬───────┘
                                     │ HTTPS / HTTP-3
┌────────────────────────────────────▼───────────────────────────────────┐
│ CLOUDFLARE EDGE                                                        │
│                                                                        │
│  DNS ─► TLS 1.3 ─► WAF ─► Bot mgmt ─► Rate limit ─► Cache rules        │
│                                                                        │
│  Answered here, never reaching the Worker:                             │
│    · /_next/static/*        1 year, immutable                          │
│    · images                 30 days                                    │
│    · /shop/*                5 minutes                                  │
│    · www → apex             Bulk Redirect, 301                         │
│    · blocked probes, challenged bots                                   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ cache miss only
┌────────────────────────────────────▼───────────────────────────────────┐
│ WORKER  good-time-production          cloudflare/worker.ts             │
│                                                                        │
│   fetch()      → OpenNext → Next.js 16 (RSC, streaming, ISR)           │
│   queue()      → runOne()  — background jobs, push-delivered           │
│   scheduled()  → drain / reservations / Klarna authorisation extension │
│                                                                        │
│   middleware.ts edge auth filter, before any React runs                 │
└──┬──────────┬───────────┬──────────────┬──────────────┬────────────────┘
   │          │           │              │              │
┌──▼───────┐ ┌▼─────────┐ ┌▼───────────┐ ┌▼───────────┐ ┌▼──────────────┐
│ Neon     │ │ Upstash  │ │ R2 + KV    │ │ Cloudflare │ │ Third parties │
│ Postgres │ │ Redis    │ │ + Durable  │ │ Queues     │ │               │
│          │ │          │ │   Objects  │ │            │ │ Klarna        │
│ pooled   │ │ cache    │ │ ISR cache  │ │ jobs       │ │ Resend        │
│ direct   │ │ limits   │ │ tag index  │ │ email      │ │ Cloudinary    │
│ (migrate)│ │          │ │ revalidate │ │ + 2 DLQs   │ │ Sentry        │
│          │ │          │ │   queue    │ │            │ │ TaxJar        │
└──────────┘ └──────────┘ └────────────┘ └────────────┘ └───────────────┘
```

---

## Why each piece

| Choice                       | Instead of           | Because                                                                                                              |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers           | Vercel, a container  | Compute at the edge, no cold-start tax, and the CDN, WAF, queues and cache are one system rather than four vendors   |
| OpenNext adapter             | A custom server      | Next's rendering model unchanged; the adapter absorbs the runtime differences                                        |
| Neon Postgres                | RDS, PlanetScale     | Serverless scaling, branching as backup, real Postgres rather than a subset                                          |
| Upstash Redis                | ElastiCache, ioredis | **Workers has no raw TCP.** A wire-protocol client cannot connect at all                                             |
| R2 for ISR                   | KV                   | Strongly consistent read-after-write. KV's propagation delay means a price change live in London and stale in Sydney |
| Durable Objects              | Nothing              | Deduplicates concurrent revalidations. Without it a hundred requests each regenerate the same expired page           |
| Cloudflare Queues + Postgres | Queues alone         | Postgres keeps transactional enqueue, dedupe, retry history and a readable DLQ                                       |
| Klarna                       | Stripe               | The chosen provider. Authorise-then-capture, merchant guaranteed                                                     |
| Resend                       | SES                  | Simple API, good deliverability tooling, Svix-signed webhooks                                                        |
| Cloudinary                   | Self-hosted          | `f_auto` and `q_auto` are the entire AVIF/WebP story, with no negotiation code                                       |
| Sentry via envelope API      | `@sentry/nextjs`     | The SDK instruments a Node runtime that does not exist here. One POST to a documented endpoint costs nothing         |

---

## Three caches, cleared three ways

The single most common source of confusion, so it is worth stating plainly.

| Layer            | Holds                                     | TTL            | Cleared by                         |
| ---------------- | ----------------------------------------- | -------------- | ---------------------------------- |
| Cloudflare edge  | Whole HTTP responses                      | 2 min – 1 year | Purge API                          |
| Next incremental | Rendered pages, `unstable_cache`          | Per route      | `revalidateTag` / `revalidatePath` |
| Upstash          | Arbitrary values: facets, settings, feeds | 60s – 1h       | `invalidate(tag)`                  |

`revalidateTag` does not clear Upstash. `invalidate` does not clear the edge.
Clearing the wrong one and concluding "caching is broken" costs an afternoon.

---

## Request lifecycles

### A cached product page

```
visitor → Cloudflare edge cache HIT → response
```

No Worker, no database, no bill. This is the overwhelming majority of traffic
and the reason the cache rules come before everything else.

### A cache miss

```
visitor → edge MISS → Worker → middleware.ts (auth filter)
        → RSC render → Next incremental cache (R2)
          ├─ HIT  → stream
          └─ MISS → services/ → Prisma → Neon (pooled)
                  → Upstash for facets and settings
                  → stream, write back to R2, cache at the edge
```

### Checkout

```
POST /api/checkout
  → withRoute: origin check, rate limit (Upstash)
  → submitCheckoutAction
      → placeOrder ── TRANSACTION ─────────────────┐
      │   totals recalculated server-side          │
      │   inventory reserved                       │
      │   order + items written                    │
      └────────────────────────────────────────────┘
      → createPaymentSession → Klarna  (outside the transaction)
  ← clientToken

  browser mounts the Klarna widget (cross-origin iframe)
  customer authorises → authorization_token

POST authorizeCheckoutAction (server action)
  → Klarna: POST /authorizations/{token}/order   [idempotency key]
  → ACCEPTED → Order PAID, cart cleared, receipt sent
  → PENDING  → wait for the push
  → REJECTED → Payment FAILED, order stays PENDING for a retry
```

Four guarantees, all in the service layer so a future mobile client inherits
them:

1. **Every total is recalculated server-side.** The client sends no prices.
2. **Inventory is reserved in the same transaction that creates the order.**
3. **An idempotency key travels to Klarna**, so a double submit cannot authorise
   twice.
4. **Klarna's own record is authoritative.** The response is a client token, not
   a confirmation.

The Klarna call is deliberately **outside** the transaction. A transaction
wrapping an external HTTP call holds a database connection open for the whole
round trip.

### A background job

```
enqueue()  ── same transaction as the write that caused it ──► background_jobs row
     │
     └─ after commit ─► Cloudflare Queue (job id only, never the payload)
                             │
                    ┌────────▼─────────┐         ┌──────────────────────┐
                    │ queue() consumer │         │ cron  * * * * *      │
                    │ claimById + run  │         │ drain() — the floor  │
                    └──────────────────┘         └──────────────────────┘
                             │                              │
                             └──────────► runJob() ◄────────┘
                                             │
                              success ── or ─┴─ fail → backoff+jitter → DEAD
```

The message is a pointer. Lose every message and the sweep still runs everything
within the minute — which is what makes it safe for `publish` to swallow its own
failures rather than failing the write that triggered it.

---

## Failure modes and what happens

| Fails             | Effect                                                                  | Recovery                                   |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Upstash           | Rate limits fail **open** (logged); cache falls back to memory          | Automatic                                  |
| Cloudflare Queues | Jobs run on the ≤60s sweep instead of in ~2s                            | Automatic                                  |
| Klarna            | Checkout returns a 502 with a clear message; existing orders unaffected | Automatic, with retries                    |
| Resend            | Emails queue and retry; five attempts then `DEAD`                       | Automatic, then manual                     |
| Cloudinary        | Images 404; the rest of the site works                                  | Manual                                     |
| Sentry            | Reports are dropped silently                                            | Automatic                                  |
| Neon              | **Full outage**                                                         | Restore or failover                        |
| Cloudflare        | **Full outage**                                                         | None; the accepted single point of failure |

Only two rows are fatal, and both are deliberate concentrations — a shop this
size building failover for either would spend more on the failover than on the
shop.

Everything else degrades in a way that is logged, reported at
`/api/health/deep`, and does not lose data.

---

## Security posture

```
    Cloudflare WAF, bot management, edge rate limiting
              │
    middleware.ts — edge auth filter, JWT only, before any React
              │
    withRoute — origin check, Upstash rate limit, error shaping
              │
    Turnstile — registration, reset, newsletter, order lookup
              │
    Zod — every input, at the trust boundary
              │
    services/ — requireAdmin, assertPermission, against the DB claim set
              │
    Prisma — parameterised queries, no string interpolation
              │
    Postgres — constraints as the last line
```

Layered on purpose. The edge filter is a fast rejection, not the authority: a
session revoked on another device still presents a valid JWT, so every page and
route re-checks against the database.

**Never simplified away**, regardless of how much code it costs: input
validation at trust boundaries, error handling that prevents data loss,
constant-time secret comparison, the consent gate on advertising tags, and
accessibility basics.

---

## Performance

| Technique                   | Where                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Edge caching                | Cloudflare rules; most traffic never reaches the Worker      |
| ISR with R2                 | Strongly consistent, deduplicated by a Durable Object        |
| Server Components           | Default; client components are opt-in                        |
| Streaming                   | Suspense boundaries around anything slow                     |
| `f_auto` / `q_auto`         | Cloudinary picks format and quality per image                |
| `sizes` on every image      | The single biggest LCP lever                                 |
| Brotli at the edge          | `compress: false` in the Worker — no CPU spent recompressing |
| `optimizePackageImports`    | Icons and motion tree-shaken                                 |
| Denormalised read paths     | `minPriceCents`, `ratingAverage` maintained on write         |
| Cursor pagination           | Storefront listings; `OFFSET 90000` scans 90,000 rows        |
| Materialised category paths | Breadcrumbs are one indexed lookup                           |

Budgets enforced by `npm run lighthouse` in CI: Performance ≥ 90,
Accessibility / Best Practices / SEO ≥ 95, LCP < 2.5s, CLS < 0.1.

Performance sits below the other three deliberately. Third-party tags cost
script time no application work recovers, and a threshold that cannot be met is
one people learn to ignore.

---

## What is deliberately absent

Worth naming, so the next person does not assume it was forgotten.

- **A distributed tracer.** OpenTelemetry on Workers means a collector, a
  sampling policy and a bill, for a request path that is one Worker plus four
  HTTP dependencies. `cf-ray` correlates the Cloudflare log to the Worker log to
  the customer's report, which covers most of it.
- **A dedicated search service.** Postgres full-text is fast and free at this
  scale. Reach for Algolia or Typesense when a measurement says otherwise, not
  before.
- **Multi-region database.** One Neon region plus edge caching. Read replicas
  are the next step, and the admin's analytics queries are the natural first
  candidate.
- **A separate worker fleet.** Queue consumers run in the same Worker. Splitting
  them is a `wrangler.jsonc` change, on the day a slow job starts affecting
  request latency.
- **A staging Klarna account shared with production.** Separate accounts, and
  `verify:production` refuses to deploy pointing at the playground.
