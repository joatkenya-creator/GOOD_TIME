# Architecture

The targets that shaped every decision below: **100k+ products**, **millions of
monthly visitors**, **thousands of concurrent users**, multiple administrators,
a future mobile client, multiple payment and shipping providers.

---

## Layers

```
  Browser / future mobile client
        │
  ┌─────▼──────────────────────────────────────────────┐
  │  src/proxy.ts          edge auth filter            │
  ├────────────────────────────────────────────────────┤
  │  src/app/              routes, layouts, handlers   │
  │  src/actions/          server actions              │
  ├────────────────────────────────────────────────────┤
  │  src/services/         business rules, ONLY layer  │
  │                        that talks to Prisma        │
  ├────────────────────────────────────────────────────┤
  │  src/lib/              infrastructure: db, auth,   │
  │                        cache, seo, security        │
  └─────┬──────────────────────────────────────────────┘
        │
   PostgreSQL          Stripe · Resend · Cloudinary
```

**The rule that keeps this honest:** a `prisma.` call outside `src/services/` (or
`src/lib/auth`) is a layering violation. Routes validate and delegate; services
decide. That boundary is what lets the mobile API reuse every rule instead of
reimplementing it — and it is why the API route handlers in phase 1 are thin
enough to be obviously correct.

### Where code goes

| Concern                            | Location                 |
| ---------------------------------- | ------------------------ |
| Domain schemas, domain types       | `src/features/<domain>/` |
| Business rules and queries         | `src/services/`          |
| Infrastructure clients and helpers | `src/lib/`               |
| Server-only auth primitives        | `src/server/auth/`       |
| Presentational components          | `src/components/`        |
| Mutations invoked from forms       | `src/actions/`           |

---

## Data model

Full schema: [`prisma/schema.prisma`](../prisma/schema.prisma).

### Rules encoded in the schema

**Money is integer cents.** Floating point money is wrong money. `Int`
everywhere; conversion happens only in `formatPrice`.

**Order lines snapshot their product.** `OrderItem` carries `productName`,
`variantName`, `sku` and `imageUrl` as plain columns. Renaming a product must
never rewrite what a customer's receipt says they bought.

**Catalogue rows are soft-deleted.** `deletedAt` on `Product`, `Variant`,
`Category`, `Brand`, `Post`. A hard delete would orphan order history.

**Denormalised read paths.** `Product.minPriceCents`, `maxPriceCents`,
`ratingAverage` and `ratingCount` are maintained from their sources. Sorting
100k products by price must not aggregate over variants per request; the write
cost is trivial by comparison.

**Materialised category paths.** `Category.path` (`/vibrators/wands`) turns
breadcrumb and subtree queries into one indexed lookup instead of a recursive CTE.

**Explicit joins where metadata matters.** `UserRole` records who granted a role
and when. `ProductCategory` and `ProductCollection` carry `position` for
merchandising order. Prisma's implicit many-to-many is used only where there is
genuinely nothing to record (`Role` ↔ `Permission`).

### Index strategy

Each index serves a query we know we will run:

| Index                                      | Serves                             |
| ------------------------------------------ | ---------------------------------- |
| `products(status, deletedAt, publishedAt)` | Default storefront listing         |
| `products(status, minPriceCents)`          | Price sort and price-range filter  |
| `products(status, ratingAverage)`          | "Top rated" sort                   |
| `variants(isActive, priceCents)`           | Variant-level price filtering      |
| `orders(userId, createdAt)`                | Customer order history             |
| `orders(status, createdAt)`                | Admin queues                       |
| `reviews(productId, status, createdAt)`    | Approved reviews on a product page |
| `categories(path)`                         | Subtree and breadcrumb lookups     |

Full-text search is deliberately _not_ in the schema yet. The intended path is a
Postgres `tsvector` column with a GIN index plus `pg_trgm` for fuzzy matching —
fast and free at this scale. Reach for a hosted search service only when
measurements say Postgres is not enough.

---

## Scaling

**Reads dominate.** A storefront is roughly 99% reads. Product, category and
collection queries go through `persistent()` (Next's data cache) with a tag per
entity, so a product edit revalidates one tag rather than dropping the whole
cache. `revalidateTag(tags.product(id))`, never `revalidatePath('/', 'layout')`.

**Connections are the first thing to break.** Serverless means N instances, each
with its own pool. `DATABASE_URL` must point at a pooler; the per-instance pool
is capped at 5 in production (`src/lib/prisma.ts`).

**Pagination.** Admin tables use offsets. Storefront listings use cursors,
because `OFFSET 90000` scans 90,000 rows to return 24. Both helpers live in
`src/lib/api/pagination.ts`; picking the wrong one is the most likely way this
system gets slow.

**Sessions cost nothing.** JWT strategy with roles and permissions flattened into
the token — an authorisation check in middleware or a layout is a signature
verification, not a query. The cost is staleness, bounded to one hour by
`CLAIMS_TTL_SECONDS`; a `session.update()` forces an immediate refresh.

**Images never touch our servers.** Uploads go browser → Cloudinary with a signed
payload. Delivery is Cloudinary → browser with transformations in the URL, so a
design change never means re-uploading 100k assets.

---

## Security

| Threat               | Control                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| CSRF                 | Strict origin check on unsafe methods + `SameSite=Lax` cookies; Server Actions add Next's own check |
| XSS                  | React escaping; `escapeJsonLd` for structured data; `safeUrl` for user-supplied links               |
| Open redirect        | `safeRedirectPath` on every `callbackUrl`                                                           |
| Clickjacking         | `X-Frame-Options: DENY`, `frame-ancestors 'none'`                                                   |
| Injection            | Prisma parameterises everything; Zod validates at every boundary                                    |
| Brute force          | Per-bucket rate limits: 10 sign-ins / 5 min, 5 registrations / hour                                 |
| Enumeration          | Constant-time password verification; identical forgot-password response either way                  |
| Token theft          | Reset and verification tokens stored as SHA-256 hashes, single-use, expiring                        |
| Privilege escalation | Capability checks server-side on every route; edge filter is a fast pre-check, not the authority    |
| Webhook forgery      | Stripe signature verification; the only routes allowed to skip the origin check                     |

**Known gap.** The CSP allows `'unsafe-inline'` on `script-src`, required by
Next's bootstrap and by the GA4/Clarity loaders. Tightening it to a nonce means
proxying the analytics scripts. Tracked, not done.

**Rate limiting ceiling.** The limiter is an in-process fixed-window counter, so
the effective limit is `limit × instances`. It is marked with a `ponytail:`
comment naming Upstash Redis as the upgrade; call sites do not change.

---

## SEO

Infrastructure only in phase 1 — no page metadata is generated yet.

- `buildMetadata()` is the single entry point for page metadata. Every page will
  call it, which is what prevents the "each page invents its own OG tags" drift.
- `canonicalUrl()` strips query strings by default. `?sort=price_asc` variants
  must not compete with the base listing in the index.
- One breadcrumb `trail` array feeds both the visible component and the JSON-LD
  `BreadcrumbList`, so they cannot disagree.
- `robots.ts` blocks cart, checkout, account and admin. Crawl budget belongs to
  product pages.
- `sitemap.ts` is static today. At 100k products it must switch to
  `generateSitemaps` with 5,000-URL chunks and cursor-paged queries — a single
  sitemap would blow Google's limits and the function's memory.

---

## Payments and shipping

Both are modelled as one-to-many from `Order`:

- `Payment` carries `provider`, `providerRef` and a unique `idempotencyKey`.
  Multiple providers, split payments and partial refunds all fit without a
  migration; the order's `paymentStatus` is the rollup.
- `Shipment` carries `carrier`, `service` and tracking. Multi-parcel orders are
  just multiple rows.

Adding PayPal means a new `PaymentProvider` enum value and one adapter. It does
not mean touching the order model.

---

## Imports

`src/features/import/contract.ts` defines the shape only. Every future source —
CSV, XML, JSON, supplier API, affiliate feed — reduces to:

```
fetch → parse → normalise → validate → reconcile → persist
```

Only the first three steps differ per source, and they live behind one
`ImportAdapter` interface. `read()` is an async generator because a 200MB
supplier CSV has to stream; materialising 100k rows in a serverless function is
how imports die at 80%.

Reconciliation is explicit (`create` / `update` / `skip`) and `managedFields`
limits what a re-import may overwrite, so a feed refresh cannot silently destroy
hand-written merchandising copy.

**Legal boundary:** adapters may only target feeds we are licensed to ingest.
Scraping a competitor's storefront is out of scope and must not be built here.

---

## Testing

Vitest, with the bar set at _one runnable check per piece of non-trivial logic_
rather than coverage percentage. Phase 1 covers the things that are easy to get
subtly wrong and expensive to get wrong: URL sanitisation, redirect safety,
JSON-LD escaping, rate-limit windows, money formatting, slug collisions,
pagination boundaries, canonical URLs.

Integration tests against a real database arrive with the services that need
them.

---

## Deliberate omissions

Each of these is a decision, not an oversight:

| Not built                         | Why, and when to add it                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Redis / distributed rate limiting | In-process counter is correct per instance. Add when traffic makes the multiplier matter.                              |
| Background job queue              | Nothing is slow enough yet. Add with imports and bulk email.                                                           |
| Full-text search                  | Needs real product data to tune. Postgres FTS first.                                                                   |
| React Email                       | Transactional emails are table-based HTML for client compatibility; a component renderer buys nothing.                 |
| Radix / headless UI               | Native `<dialog>`, `<select>` and `accent-color` cover phase 1. Add when a component genuinely needs a custom listbox. |
| A state-management library        | Server Components hold server state; TanStack Query holds the rest.                                                    |
| Storybook                         | 13 components. Add when the design system outgrows reading the source.                                                 |
