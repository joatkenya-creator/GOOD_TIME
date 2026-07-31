# Installation

## Requirements

| Tool       | Version | Note                                               |
| ---------- | ------- | -------------------------------------------------- |
| Node.js    | ≥ 20.9  | 22 LTS recommended; matches CI                     |
| npm        | ≥ 10    | The lockfile is npm's; do not mix package managers |
| PostgreSQL | ≥ 15    | 17 in CI                                           |

---

## 1. Install dependencies

```bash
npm install
```

`postinstall` does not generate the Prisma client — `npm run build` and
`npm run db:*` do. Run `npm run db:generate` manually after pulling a schema
change.

## 2. Get a database

Any of these works. Pick one.

**Local Postgres (Docker)**

```bash
docker run --name goodtime-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=good_time -p 5432:5432 -d postgres:17
```

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/good_time
```

**Neon / Supabase / Vercel Postgres**

Use the **pooled** connection string for `DATABASE_URL` and the **direct** one
for `DIRECT_DATABASE_URL`. Migrations need a direct connection: a transaction
pooler cannot run the session-level statements the schema engine issues.

```
DATABASE_URL=postgresql://…@…-pooler.…/db?sslmode=verify-full
DIRECT_DATABASE_URL=postgresql://…@….…/db?sslmode=verify-full
```

**Use `verify-full`, not the `sslmode=require` these providers hand you.**
`node-postgres` currently treats `require`, `prefer` and `verify-ca` as aliases
for `verify-full` and warns that it will stop doing so: in `pg@9` they adopt
libpq semantics, where `require` encrypts the connection but verifies neither the
certificate chain nor the hostname. That is a silent downgrade to a connection
that can be intercepted. Naming `verify-full` explicitly keeps today's behaviour
after that upgrade — and silences the warning, which otherwise surfaces in the
Next.js dev overlay against whichever page happens to open the first connection.

## 3. Configure the environment

```bash
cp .env.example .env
```

Two variables are mandatory; everything else is optional in phase 1.

```bash
# Generate the auth secret
openssl rand -base64 32
# Windows PowerShell:
# [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```

Set `DATABASE_URL` and `AUTH_SECRET`. Every variable is documented in
[environment.md](environment.md).

Validation runs at boot: a missing or malformed variable fails fast with a list
of exactly what is wrong, rather than a null-pointer three requests later.

## 4. Create the schema

```bash
npm run db:migrate    # development: creates and applies a migration
# or
npm run db:push       # prototyping: sync without a migration file
```

## 5. Seed

```bash
npm run db:seed
```

Creates the `CUSTOMER`, `ADMIN` and `SUPER_ADMIN` roles, their permissions, and
baseline settings. Idempotent — safe to re-run on every deploy. No demo products
are seeded; fixtures belong in tests.

**The app will not let anyone register until this has run** — new accounts need
the `CUSTOMER` role to exist.

## 6. Run

```bash
npm run dev
```

## 7. Make yourself an administrator

Register through `/register`, then:

```bash
npm run grant-admin -- you@example.com SUPER_ADMIN
```

Sign out and back in — roles are carried in the session token.

There is deliberately no UI for creating the first admin. Bootstrapping happens
from a shell where you already hold database credentials, not from a public form
someone else could reach first.

---

## Verifying the install

```bash
npm run typecheck   # no output means clean
npm run lint
npm test
npm run build
curl http://localhost:3000/api/health
```

`/api/health` returns `{"ok":true,"data":{"status":"ok","database":{…}}}` and
actually queries the database — a health check that only proves Node is running
stays green through an outage.

---

## Deploying to Vercel

1. Import the repository.
2. Add the environment variables from [environment.md](environment.md) to
   Production, Preview and Development.
3. Set the build command to `npm run build` (it runs `prisma generate` first).
4. Run migrations from CI or locally with `npm run db:deploy` — Vercel builds
   should not migrate the production database as a side effect.
5. Point `NEXT_PUBLIC_SITE_URL` and `AUTH_URL` at the production domain, not the
   `*.vercel.app` preview URL, or canonical URLs and OAuth callbacks will be wrong.

---

## Common problems

**`Invalid environment variables`** — read the list it prints; each line names
the variable and what is wrong with it. Compare against `.env.example`.

**`Roles are not seeded`** on registration — run `npm run db:seed`.

**`PrismaClientInitializationError`** — `DATABASE_URL` is unreachable. Check the
database is running and, for hosted providers, that `?sslmode=verify-full` is
present.

**`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'…`** — a
connection string still says `sslmode=require`. Change it to `verify-full` as
above. If your provider uses a private CA that Node does not trust, `verify-full`
will fail to connect; `?uselibpqcompat=true&sslmode=require` is the documented
fallback, at the cost of no certificate or hostname verification.

**Migrations hang or fail on a hosted database** — you are pointing at the
pooled endpoint. Set `DIRECT_DATABASE_URL`.

**Types missing after a schema change** — `npm run db:generate`.

**Prisma client not found** — `src/generated/` is gitignored; it is a build
artefact. Regenerate it.

**Too many database connections in production** — `DATABASE_URL` points at a
direct endpoint instead of a pooler. Each serverless instance opens its own pool.
