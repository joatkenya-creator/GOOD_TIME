# INTIMATE BUNNIE

A production-grade ecommerce platform for a US adult-products retailer — sex toys
with published material and performance specs — built on Next.js 16 and PostgreSQL.

Every listing is 18+ and age-restricted by default (`Product.isAdultOnly`), and
discretion is a product requirement rather than a nice-to-have: plain packaging,
neutral billing descriptor, and no product names in email subject lines.

An 18+ age gate covers the whole site — see
[`src/lib/age-gate.ts`](src/lib/age-gate.ts) for why it is client-side (so the
catalogue stays indexable and the homepage stays statically rendered). It is a
good-faith age _statement_, not identity verification; where a state mandates the
latter, it belongs at checkout against an identity provider and recorded on the
order.

**Phase 1 — architecture and foundation.** Scaffolding, data model, auth,
security and SEO machinery.

**Phase 2 — visual identity and homepage.** Design tokens, a 30+ component
library, header with mega menu, footer, and a twelve-section homepage.

**Phase 3 — catalogue.** Product listing, category pages, product detail, faceted
filtering, Postgres full-text search, reviews, wishlist, compare and recently
viewed. See [docs/catalog.md](docs/catalog.md).

**Phase 4 — shopping and checkout.** Cart, shipping rates, assessed sales tax,
order placement with transactional stock reservation. See
[docs/checkout.md](docs/checkout.md).

**Phase 5 — customer accounts.** Order history, addresses, returns, rewards,
wishlists, sessions. See [docs/account.md](docs/account.md).

**Phase 6 — administration.** Dashboard, catalogue management, fulfilment,
role-based permissions, audit logging. See [docs/admin.md](docs/admin.md).

**Phase 7 — scale.** Supplier imports, background jobs, media pipeline, SEO
feeds, analytics. See [docs/platform.md](docs/platform.md).

**Phase 8 — production.** Cloudflare Workers deployment, Klarna payments,
Upstash-backed cache and rate limiting, Cloudflare Queues, Sentry, an automated
test suite, CI/CD, and the operational documentation to run it. See
[docs/production-architecture.md](docs/production-architecture.md) and
[docs/go-live.md](docs/go-live.md).

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Set DATABASE_URL and AUTH_SECRET at minimum.
#    Generate a secret: openssl rand -base64 32

# 3. Create the schema and seed roles
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev
```

The app boots at http://localhost:3000.

| Path               | What it is                  |
| ------------------ | --------------------------- |
| `/`                | Homepage — twelve sections  |
| `/account`         | Signed-in session readout   |
| `/sign-in`         | Sign-in form                |
| `/register`        | Account creation            |
| `/forgot-password` | Password reset request      |
| `/shop`            | Product listing, filtered   |
| `/shop/vibrators`  | Category page               |
| `/search?q=…`      | Search results              |
| `/compare`         | Product comparison          |
| `/search?q=…`      | Search results              |
| `/compare`         | Product comparison          |
| `/api/health`      | Liveness + database check   |
| `/robots.txt`      | Generated robots directives |
| `/sitemap.xml`     | Generated sitemap           |
| `/feed.xml`        | Buying-guides RSS feed      |

Navigation links point at shop, category and collection routes that arrive in a
later phase; those currently render the 404 page.

Full setup guide: [docs/installation.md](docs/installation.md).

---

## Stack

| Layer          | Choice                                                        |
| -------------- | ------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, React 19)                             |
| Language       | TypeScript, strict                                            |
| Styling        | Tailwind CSS v4 (CSS-first `@theme`)                          |
| Motion         | Framer Motion                                                 |
| Forms          | React Hook Form + Zod                                         |
| Client data    | TanStack Query                                                |
| Database       | Neon PostgreSQL (pooled)                                      |
| ORM            | Prisma 7 (`@prisma/adapter-pg`)                               |
| Auth           | Auth.js v5                                                    |
| **Hosting**    | **Cloudflare Workers** via OpenNext                           |
| **Payments**   | **Klarna** — authorise at checkout, capture at fulfilment     |
| **Cache**      | **Upstash Redis** (REST — Workers has no raw TCP)             |
| **Queues**     | **Cloudflare Queues** + Postgres ledger                       |
| **ISR cache**  | **R2 + KV + Durable Objects**                                 |
| Email          | Resend (`yowens@yoassoc.com`)                                 |
| Media          | Cloudinary                                                    |
| Tax            | TaxJar                                                        |
| **Monitoring** | **Sentry**, Cloudflare Analytics                              |
| Bot protection | Cloudflare WAF, bot management, Turnstile                     |
| Analytics      | GA4, GTM, Google Ads, Meta, TikTok, Pinterest, Clarity, CF WA |
| Testing        | Vitest, Playwright, axe-core, Lighthouse                      |

---

## Scripts

| Command                     | Does                                              |
| --------------------------- | ------------------------------------------------- |
| `npm run dev`               | Development server                                |
| `npm run build`             | `prisma generate` then a production build         |
| `npm start`                 | Serve the production build                        |
| `npm run lint`              | ESLint                                            |
| `npm run format`            | Prettier, write                                   |
| `npm run typecheck`         | `tsc --noEmit`, app and Worker                    |
| `npm test`                  | Vitest                                            |
| `npm run test:e2e`          | Playwright, against a production build            |
| `npm run cf:build`          | `next build` then the OpenNext transform          |
| `npm run cf:preview`        | Run it locally in workerd with real bindings      |
| `npm run cf:deploy`         | Build and deploy to production                    |
| `npm run verify:production` | Refuse to launch a half-configured environment    |
| `npm run verify:links`      | Broken links, missing images, duplicate metadata  |
| `npm run lighthouse`        | Performance budgets, as a gate                    |
| `npm run db:migrate`        | Create and apply a migration (development)        |
| `npm run db:deploy`         | Apply pending migrations (production)             |
| `npm run db:seed`           | Seed roles, permissions and settings — idempotent |
| `npm run db:studio`         | Prisma Studio                                     |
| `npm run db:seed:catalog`   | Demo products — development only                  |
| `npm run db:verify`         | Tables, functional indexes, check constraints     |
| `npm run smoke:catalog`     | 27 catalogue checks against the database          |
| `npm run grant-admin`       | `-- you@example.com SUPER_ADMIN`                  |

---

## Documentation

**Start here:** [docs/onboarding.md](docs/onboarding.md) — running in half an hour.

### The application

| Document                                             | Covers                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| [docs/onboarding.md](docs/onboarding.md)             | Getting set up, conventions, common tasks     |
| [docs/installation.md](docs/installation.md)         | Setup, database options, common problems      |
| [docs/architecture.md](docs/architecture.md)         | Layering, data flow, scaling decisions        |
| [docs/folder-structure.md](docs/folder-structure.md) | What belongs where, and why                   |
| [docs/design-system.md](docs/design-system.md)       | Tokens, typography, contrast, brand rules     |
| [docs/components.md](docs/components.md)             | Component index and conventions               |
| [docs/catalog.md](docs/catalog.md)                   | Data model, query strategy, search, SEO       |
| [docs/checkout.md](docs/checkout.md)                 | Cart, totals, tax, order placement            |
| [docs/account.md](docs/account.md)                   | Customer accounts, orders, returns, rewards   |
| [docs/admin.md](docs/admin.md)                       | Admin dashboard and permissions               |
| [docs/platform.md](docs/platform.md)                 | Imports, jobs, search, media pipeline         |
| [docs/quality.md](docs/quality.md)                   | Accessibility and responsiveness verification |
| [src/app/api/README.md](src/app/api/README.md)       | API conventions and route map                 |

### Production

| Document                                                           | Covers                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| [docs/production-architecture.md](docs/production-architecture.md) | The deployed system, and why each piece                  |
| [docs/deployment.md](docs/deployment.md)                           | Cloudflare Workers deployment, first time and every time |
| [docs/cloudflare.md](docs/cloudflare.md)                           | DNS, SSL, WAF, cache rules, bot protection, queues       |
| [docs/neon.md](docs/neon.md)                                       | Database setup, pooling, backups, restores               |
| [docs/prisma.md](docs/prisma.md)                                   | Production migrations, expand-and-contract, rollback     |
| [docs/upstash.md](docs/upstash.md)                                 | Cache and rate-limit store                               |
| [docs/cloudinary.md](docs/cloudinary.md)                           | Image upload, transformation, lifecycle                  |
| [docs/klarna.md](docs/klarna.md)                                   | Payments: authorise, capture, refund, reconcile          |
| [docs/email.md](docs/email.md)                                     | Deliverability, templates, bounces                       |
| [docs/queues.md](docs/queues.md)                                   | Background processing and dead letters                   |
| [docs/environment.md](docs/environment.md)                         | Every environment variable, and rotation                 |
| [docs/monitoring.md](docs/monitoring.md)                           | Sentry, metrics, logs, health, alerts                    |
| [docs/troubleshooting.md](docs/troubleshooting.md)                 | Symptom-first, for when it is broken                     |
| [docs/disaster-recovery.md](docs/disaster-recovery.md)             | Backups, restores, incident response                     |
| [docs/go-live.md](docs/go-live.md)                                 | The launch checklist                                     |
| [docs/maintenance.md](docs/maintenance.md)                         | Daily, weekly, monthly, quarterly                        |

---

## Conventions worth knowing before you write code

**Money is integer cents.** `priceCents: 1999`, never `19.99`. Convert only at
the render boundary with `formatPrice`.

**Services own the database.** Route handlers and server actions validate input
and delegate. If you find a `prisma.` call in `src/app/`, it is in the wrong
place.

**Authorisation is capability-based.** Check `can(user, PERMISSIONS.orderRefund)`,
never `user.role === 'ADMIN'`.

**Config exports must be literals.** `export const revalidate = 3_600`, not
`CACHE_SECONDS.hour` — Next reads segment config statically.

**Order lines are snapshots.** Editing a product must never alter what a past
order says was bought.
