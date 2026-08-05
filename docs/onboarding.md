# Developer onboarding

Running in half an hour, productive in a day.

---

## Day one

### 1. Prerequisites

- Node 22 (the engines field says ≥ 20.9; CI uses 22)
- Postgres 17 locally, or a Neon `dev` branch
- Git

### 2. Clone and install

```bash
git clone <repo> && cd GOOD_TIME
npm ci
cp .env.example .env
```

### 3. The two variables you actually need

```bash
# .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/good_time
AUTH_SECRET=<openssl rand -base64 32>
```

Everything else is optional and degrades cleanly: the cache falls back to
memory, emails log instead of sending, payments refuse with a clear message.
That is deliberate — see [environment.md](./environment.md#two-tiers-on-purpose).

### 4. Database

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed              # roles, permissions, settings, shipping, tax
npm run db:seed:catalog      # demo products
npm run db:seed:customers    # ada.demo@example.test / GoodTimeDemo2026!
npm run db:seed:admin        # admin.demo@example.test / GoodTimeAdmin2026!
```

### 5. Run it

```bash
npm run dev
```

- Storefront: http://localhost:3000
- Admin: http://localhost:3000/admin

### 6. Confirm it works

```bash
npm run typecheck
npm test
```

---

## Read these, in this order

1. **[architecture.md](./architecture.md)** — the layering rule. One rule
   explains most of the file structure.
2. **[production-architecture.md](./production-architecture.md)** — where it
   runs and why each vendor was chosen.
3. **[folder-structure.md](./folder-structure.md)** — where things go.
4. The domain doc for whatever you are touching: [catalog](./catalog.md),
   [checkout](./checkout.md), [account](./account.md), [admin](./admin.md).

Then whichever of [klarna](./klarna.md), [queues](./queues.md),
[upstash](./upstash.md), [neon](./neon.md) or [email](./email.md) your change
touches.

---

## The one rule

> **A `prisma.` call outside `src/services/` (or `src/lib/auth`) is a layering
> violation.**

Routes and actions validate and delegate. Services decide. That boundary is what
lets a future mobile client reuse every rule instead of reimplementing it, and
it is why the route handlers are thin enough to be obviously correct.

```
src/app/          routes, layouts, route handlers   — thin
src/actions/      server actions from forms         — thin
src/services/     business rules                    — the only Prisma caller
src/lib/          infrastructure: db, auth, cache, security, seo
src/features/     domain schemas and pure logic     — no I/O, easy to test
src/components/   presentation
```

`src/features/` is where the genuinely testable logic lives — totals, pricing,
loyalty rules, facets. Pure functions, no I/O, which is why the unit tests are
worth writing there and thin elsewhere.

---

## Common tasks

### Change the database schema

```bash
# edit prisma/schema.prisma
npm run db:migrate           # creates and applies a migration
```

Then read [prisma.md](./prisma.md#expand-and-contract) **before** dropping or
renaming anything. Migrations here are expand-only, because `wrangler rollback`
reverts the Worker in seconds and cannot un-drop a column.

### Add an API route

```ts
export const GET = withRoute(
  async ({ request }) => {
    const input = readQuery(request, schema);
    return jsonOk(await someService(input));
  },
  { rateLimit: { bucket: 'products', limit: 120 } },
);
```

`withRoute` gives you the origin check, the rate limit, error shaping, logging
and Sentry reporting. Never write a bare route handler — those cross-cutting
concerns are declared once here rather than copy-pasted into thirty files and
eventually forgotten in the thirty-first.

### Add a background job

1. `registerHandler('domain.action', ...)` in
   [`lib/jobs/handlers.ts`](../src/lib/jobs/handlers.ts).
2. **Make it idempotent.** It will run twice — see
   [queues.md](./queues.md#idempotency).
3. `context.progress()` if it is long.
4. `DEFAULT_SCHEDULES` if it is periodic.

### Cache something

```ts
import { remember, keys, TTL } from '@/lib/cache/store';

const facets = await remember(keys.facets(id), TTL.facets, () => compute(id), ['facets']);
```

For page-level caching, use Next's `unstable_cache` via
[`lib/cache/cached.ts`](../src/lib/cache/cached.ts) instead — different layer,
different invalidation. See
[production-architecture.md](./production-architecture.md#three-caches-cleared-three-ways).

### Run the E2E suite

```bash
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:e2e:ui          # debugging
```

Against a production build, not the dev server. `next dev` is a different
application — unminified, differently cached, with an error overlay that
swallows failures a customer would see.

---

## Testing

| Kind        | Where                                               | Runs against                     |
| ----------- | --------------------------------------------------- | -------------------------------- |
| Unit        | `tests/*.test.ts`                                   | Pure functions, mocked transport |
| Integration | `scripts/verify-*.ts`                               | A real database                  |
| E2E         | `e2e/*.spec.ts`                                     | A real build in a real browser   |
| Quality     | `scripts/verify-links.mjs`, `lighthouse-budget.mjs` | A running site                   |

Fixtures are in `tests/fixtures/`; the `fetch` stub is `tests/mocks/fetch.ts`.

Mock at the **transport** boundary, not the module boundary. Mocking
`@/lib/integrations/klarna` verifies that a mock returns what the mock was told
to return. Mocking `fetch` leaves the real request builder, auth header, retry
policy and error mapping in the path.

---

## Conventions

- **Money is integer cents**, everywhere. Conversion happens only in
  `formatPrice`. Floating-point money is wrong money.
- **Comments explain _why_.** The code says what. A comment restating the code
  is noise; a comment naming the failure a line prevents is the reason someone
  does not delete it in six months.
- **Errors are `AppError`.** `withRoute` maps them to a status and a stable
  machine-readable code. Anything else is a bug, reported as a 500 with the
  details logged and not returned.
- **Validate at the boundary.** Zod at every entry point. Services may assume
  their inputs are already valid.
- **`server-only`** on anything that must never reach the browser.
- **Log events, not sentences.** `klarna.push`, not `"Got a Klarna push"`.

---

## Before opening a pull request

```bash
npm run format
npm run lint
npm run typecheck
npm test
```

CI runs all four plus migrations, the build, E2E, link checking, Lighthouse and
a dependency audit. Running them locally is faster than waiting.

If you touched a migration, also:

```bash
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

Non-zero means the schema and the migrations disagree — the most common mistake,
and the one that would otherwise be found by a production deploy.

---

## Deploying

You probably do not deploy by hand.

- Merge to `main` → staging, automatically.
- Production → a manual `workflow_dispatch`, gated on reviewers.

If you do need to: [deployment.md](./deployment.md).

---

## Getting unstuck

| Question                                | Where                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Why is my type wrong after pulling?     | `npx prisma generate`                                                                                           |
| Why does my change not appear?          | Three cache layers — [production-architecture.md](./production-architecture.md#three-caches-cleared-three-ways) |
| Why does the payment widget not load?   | [klarna.md](./klarna.md#common-failures)                                                                        |
| Why is my job not running?              | [queues.md](./queues.md#monitoring)                                                                             |
| Something is broken in production       | [troubleshooting.md](./troubleshooting.md)                                                                      |
| What does this environment variable do? | [environment.md](./environment.md)                                                                              |

Most non-obvious decisions are explained in a comment at the top of the file
that implements them. If something looks strange, read the file's header before
assuming it is wrong — and if the comment is missing, that is worth fixing too.
