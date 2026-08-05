# API surface

One folder per bounded context. Every handler is wrapped in `withRoute`, which
supplies origin checking, rate limiting, error shaping and logging — see
[`src/lib/api/handler.ts`](../../lib/api/handler.ts).

| Route                          | Purpose                                    | Auth                 |
| ------------------------------ | ------------------------------------------ | -------------------- |
| `/api/health`                  | Liveness + database reachability           | public               |
| `/api/auth/[...nextauth]`      | Auth.js sign-in, callbacks, session        | public               |
| `/api/auth/register`           | Account creation                           | public               |
| `/api/products`                | Catalogue listing, filtering, facets       | public               |
| `/api/products/[slug]`         | Single product with variants and inventory | public               |
| `/api/search`                  | Full-text and faceted search               | public               |
| `/api/blog`                    | Published posts                            | public               |
| `/api/cart`                    | Cart read and mutation                     | session or cookie    |
| `/api/checkout`                | Payment intent, order placement            | session or cookie    |
| `/api/orders`                  | Order history for the signed-in customer   | customer             |
| `/api/users/me`                | Profile read and update                    | customer             |
| `/api/admin/*`                 | Back-office operations                     | admin permission     |
| `/api/analytics`               | Server-side event ingestion                | public, throttled    |
| `/api/webhooks/klarna/[token]` | Klarna push notifications                  | URL secret + re-read |
| `/api/webhooks/resend`         | Bounces and complaints                     | Svix signature       |

## Conventions

**Envelope.** Success is `{ ok: true, data, meta? }`; failure is
`{ ok: false, error: { code, message, fieldErrors? } }`. The future mobile client
writes one deserialiser, not fourteen.

**Validation.** Bodies go through `readJson(request, schema)`, query strings
through `readQuery(request, schema)`. A handler never touches `request.json()`
directly — an unvalidated body is how untyped data reaches the database.

**Authorisation.** Handlers call `assertUser` / `assertPermission` from
`@/server/auth/session`, which throw and become a 401/403. Middleware is a fast
pre-filter, not the authority.

**Pagination.** Admin tables use offset (`pageQuerySchema`); storefront listings
use cursors (`cursorQuerySchema`), because `OFFSET 90000` on a 100k-row table
scans 90,000 rows to return 24.

**Caching.** Public catalogue responses set `cacheControl.catalogue`; anything
derived from a session sets `cacheControl.private`. There is no middle ground.

**Webhooks** disable the origin check (`csrf: false`) and verify a provider
signature instead. They are the only routes allowed to do so.
