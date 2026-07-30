# GOOD TIME

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
library, header with mega menu, footer, and a twelve-section homepage running on
placeholder content.

Shop, product, cart and checkout pages are deliberately **not** built yet.

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
| `/api/health`      | Liveness + database check   |
| `/robots.txt`      | Generated robots directives |
| `/sitemap.xml`     | Generated sitemap           |
| `/feed.xml`        | Buying-guides RSS feed      |

Navigation links point at shop, category and collection routes that arrive in a
later phase; those currently render the 404 page.

Full setup guide: [docs/installation.md](docs/installation.md).

---

## Stack

| Layer       | Choice                                 |
| ----------- | -------------------------------------- |
| Framework   | Next.js 16 (App Router, React 19)      |
| Language    | TypeScript, strict                     |
| Styling     | Tailwind CSS v4 (CSS-first `@theme`)   |
| Motion      | Framer Motion                          |
| Forms       | React Hook Form + Zod                  |
| Client data | TanStack Query                         |
| Database    | PostgreSQL                             |
| ORM         | Prisma 7 (`@prisma/adapter-pg`)        |
| Auth        | Auth.js v5                             |
| Payments    | Stripe _(configured, not wired)_       |
| Email       | Resend _(configured, not wired)_       |
| Media       | Cloudinary _(configured, not wired)_   |
| Analytics   | GA4, Search Console, Microsoft Clarity |
| Hosting     | Vercel                                 |

---

## Scripts

| Command               | Does                                              |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Development server                                |
| `npm run build`       | `prisma generate` then a production build         |
| `npm start`           | Serve the production build                        |
| `npm run lint`        | ESLint                                            |
| `npm run format`      | Prettier, write                                   |
| `npm run typecheck`   | `tsc --noEmit`                                    |
| `npm test`            | Vitest                                            |
| `npm run db:migrate`  | Create and apply a migration (development)        |
| `npm run db:deploy`   | Apply pending migrations (production)             |
| `npm run db:seed`     | Seed roles, permissions and settings — idempotent |
| `npm run db:studio`   | Prisma Studio                                     |
| `npm run grant-admin` | `-- you@example.com SUPER_ADMIN`                  |

---

## Documentation

| Document                                             | Covers                                    |
| ---------------------------------------------------- | ----------------------------------------- |
| [docs/installation.md](docs/installation.md)         | Setup, database options, common problems  |
| [docs/architecture.md](docs/architecture.md)         | Layering, data flow, scaling decisions    |
| [docs/folder-structure.md](docs/folder-structure.md) | What belongs where, and why               |
| [docs/environment.md](docs/environment.md)           | Every environment variable                |
| [docs/design-system.md](docs/design-system.md)       | Tokens, typography, contrast, brand rules |
| [docs/components.md](docs/components.md)             | Component index and conventions           |
| [src/app/api/README.md](src/app/api/README.md)       | API conventions and route map             |

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
