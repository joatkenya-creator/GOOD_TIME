# Folder structure

```
.
├── .github/workflows/     CI: lint, types, tests, build, migration check
├── docs/                  This documentation
├── prisma/
│   ├── schema.prisma      Data model
│   ├── seed.ts            Roles, permissions, settings — idempotent
│   └── client.ts          Prisma client for scripts (no `server-only`)
├── public/                Static assets served as-is
├── scripts/
│   └── grant-role.ts      Bootstrap the first administrator
├── src/
│   ├── actions/           Server Actions
│   ├── app/               Routes (App Router)
│   ├── components/        Presentational React
│   ├── config/            Brand, SEO and navigation configuration
│   ├── constants/         Routes, permissions, cookies, TTLs
│   ├── emails/            Transactional email templates
│   ├── features/          Domain modules: schemas and contracts
│   ├── generated/         Prisma client — build artefact, gitignored
│   ├── hooks/             Client-side React hooks
│   ├── lib/               Infrastructure
│   ├── providers/         Client provider tree
│   ├── server/            Server-only primitives
│   ├── services/          Business logic — the only Prisma consumers
│   ├── styles/            Global CSS and design tokens
│   ├── types/             Shared types and module augmentation
│   ├── utils/             Pure, dependency-light helpers
│   └── proxy.ts           Edge auth filter (Next 16's `middleware`)
├── tests/                 Vitest suites
└── [config files]         next, tsconfig, eslint, prettier, postcss, vitest
```

---

## src/app — routes

```
app/
├── layout.tsx             Root layout: fonts, providers, analytics, skip link
├── not-found.tsx          404 — also what `/` renders in phase 1
├── error.tsx              Route error boundary
├── global-error.tsx       Root-layout failure boundary (inline styles only)
├── loading.tsx            Default suspense fallback
├── robots.ts              /robots.txt
├── sitemap.ts             /sitemap.xml
├── manifest.ts            /manifest.webmanifest
├── feed.xml/route.ts      Journal RSS
├── (auth)/                Route group: chrome-free auth shell
│   ├── layout.tsx
│   ├── sign-in/
│   ├── register/
│   ├── forgot-password/
│   ├── reset-password/
│   └── verify-email/
└── api/                   See src/app/api/README.md
```

Route groups `(name)` do not appear in the URL. `(auth)` exists so the auth pages
get their own minimal shell without a `/auth` prefix.

Co-location rule: a client component used by exactly one page lives next to that
page (`sign-in/sign-in-form.tsx`). It moves to `src/components/` the moment a
second page needs it — not before.

---

## src/components

| Folder        | Holds                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `ui/`         | The design system. Generic, brandless in behaviour, reusable anywhere. |
| `layout/`     | Structural primitives: `Container`, `Section`.                         |
| `forms/`      | Form plumbing: `FormField`, `SubmitButton`.                            |
| `navigation/` | Navigation UI: `Breadcrumbs`.                                          |
| `common/`     | Cross-cutting non-visual components: `JsonLd`, `Analytics`.            |
| `product/`    | Product-specific UI. Phase 2.                                          |
| `cart/`       | Cart-specific UI. Phase 3.                                             |

The distinction that matters: `ui/` components know nothing about commerce.
`Button` does not know what an order is. `product/` components do.

Everything in `components/`, `hooks/` and `providers/` is blocked by ESLint from
importing `@/server/*`, `@/services/*` or `@/lib/prisma` — a client component
that reaches for the database is a build error, not a runtime surprise.

---

## src/lib — infrastructure

| Path            | Holds                                                                |
| --------------- | -------------------------------------------------------------------- |
| `env.ts`        | Server environment, validated at boot                                |
| `env.public.ts` | Client-visible environment                                           |
| `prisma.ts`     | Database client singleton                                            |
| `logger.ts`     | Structured logging                                                   |
| `auth/`         | Auth.js — `config.ts` is edge-safe, `index.ts` is Node-only          |
| `api/`          | Route handler wrapper, error taxonomy, response envelope, pagination |
| `security/`     | Headers, CSRF, rate limiting, sanitisation                           |
| `seo/`          | Metadata, JSON-LD, breadcrumbs, URLs                                 |
| `cache/`        | Cache tags and the two caching layers                                |
| `performance/`  | Fonts, images, dynamic imports                                       |
| `integrations/` | Stripe, Resend, Cloudinary                                           |
| `analytics/`    | Typed GA4 event contract                                             |

The `auth/` split is not cosmetic. `middleware`/`proxy` runs on the Edge runtime
where Prisma and bcrypt cannot; `config.ts` contains only what the edge needs.

---

## src/features vs src/services

Easy to confuse, so:

- **`features/`** — what a domain _is_. Zod schemas, types, contracts. Imported
  by both client and server. `features/auth/schemas.ts` is the single source of
  truth for the sign-in form's client validation _and_ the server action's.
- **`services/`** — what a domain _does_. Business rules and database access.
  Server-only, always.

---

## src/utils vs src/lib

- **`utils/`** — pure functions with no infrastructure dependency. `formatPrice`,
  `slugify`, `cn`. Safe anywhere, trivially testable.
- **`lib/`** — anything that touches a client, the environment or a framework API.

If it needs a mock to test, it belongs in `lib/`.

---

## Imports

One alias: `@/*` → `src/*`. Absolute imports everywhere except within the same
directory.

```ts
import { Button } from '@/components/ui'; // barrel, for design system
import { prisma } from '@/lib/prisma'; // direct, for everything else
import { SignInForm } from './sign-in-form'; // relative, same directory only
```

Barrels exist only where they earn their keep — `components/ui`, `constants`,
`hooks`, `utils`, `types`. Barrelling every folder creates import cycles and
defeats tree shaking.
