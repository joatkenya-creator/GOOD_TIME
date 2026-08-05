# Prisma in production

Schema, migrations, and the rules that keep a deploy reversible.

---

## The migration workflow

### Development

```bash
# Edit prisma/schema.prisma, then:
npm run db:migrate          # prisma migrate dev — creates SQL, applies it, regenerates
```

`migrate dev` uses a shadow database to diff the schema, which is why it needs
`DIRECT_DATABASE_URL`. Never run it against staging or production; it can
prompt to reset.

### Staging and production

```bash
npm run db:migrate:deploy   # prisma migrate deploy — applies committed SQL, nothing else
npm run db:migrate:status   # what has and has not been applied
```

`migrate deploy` never generates, never prompts, never resets. It applies the
committed files in order and stops on the first failure. That is the only
command that should ever touch a real database.

It runs in CI over the **unpooled** connection — see
[neon.md](./neon.md#why-migrations-must-not) for why the pooler breaks Prisma's
advisory lock.

---

## What CI checks

[`ci.yml`](../.github/workflows/ci.yml) runs four things against a throwaway
Postgres:

1. **`prisma validate`** — the schema parses and is internally consistent.
2. **`migrate deploy`** — every committed migration applies to an empty
   database. Catches SQL that only worked because of what was already there.
3. **`migrate diff --exit-code`** — no drift between `schema.prisma` and the
   migrations. This is the one that catches the most common mistake: editing the
   schema and forgetting to generate a migration. Without it, the drift is
   discovered by a production deploy.
4. **`migrate deploy` again** — migrations are re-runnable. A migration that
   cannot be applied twice cannot be retried after a partial failure, which is
   exactly when it will be.

---

## Expand and contract

**The rule: a migration must be safe to run while the previous version of the
code is still serving traffic.**

Cloudflare deploys are not instantaneous and rollbacks are instant. Between
`migrate deploy` and every isolate running new code, both versions are live at
once. A migration that breaks the old code turns a rollback from a fix into a
second outage.

So every breaking change is two or three releases.

### Renaming a column

```
Release 1  ADD "fullName";  write to both, read from "name"
Release 2  backfill "fullName";  read from "fullName", still write both
Release 3  (a week later, once rollback is off the table)  DROP "name"
```

### Dropping a column

```
Release 1  stop writing and reading it
Release 2  DROP COLUMN
```

Never in one release. `wrangler rollback` reverts the Worker in seconds and
cannot un-drop a column, so a combined release is a rollback that loses data.

### Adding a NOT NULL column

```sql
-- Wrong: rewrites the whole table and fails on existing rows.
ALTER TABLE "products" ADD COLUMN "sku" TEXT NOT NULL;

-- Right: three steps, none of them blocking.
ALTER TABLE "products" ADD COLUMN "sku" TEXT;
UPDATE "products" SET "sku" = 'LEGACY-' || id WHERE "sku" IS NULL;   -- batched
ALTER TABLE "products" ALTER COLUMN "sku" SET NOT NULL;              -- next release
```

### Adding an index

```sql
-- Locks the table against writes for the duration. On a large table that is an
-- outage.
CREATE INDEX "idx" ON "products" ("categoryId");

-- Does not. Slower, and it can leave an invalid index if it fails — check with
-- `\d products` and drop the invalid one before retrying.
CREATE INDEX CONCURRENTLY "idx" ON "products" ("categoryId");
```

Prisma does not emit `CONCURRENTLY`. Generate the migration, then edit the SQL
by hand before committing it. Note that `CONCURRENTLY` cannot run inside a
transaction, so the migration must contain nothing else.

### Enum values

Postgres will not let a new enum label be used in the transaction that created
it. That is why the Klarna change is two migrations:

- `20260804120000_phase8_klarna_production` — `ADD VALUE 'KLARNA'`
- `20260804120001_phase8_klarna_default` — `SET DEFAULT 'KLARNA'`

Removing an enum value is not supported at all. `STRIPE` stays in
`PaymentProvider` permanently because historical payment rows use it and always
will.

---

## Rollback

**There is no `prisma migrate down`.** Prisma does not generate down migrations
and adding them by hand gives false confidence — a down migration that drops a
column also drops the data written since.

The real strategy, in order of preference:

1. **Roll back the Worker only.** `wrangler rollback --env production`. Works
   because migrations are expand-only, which is the whole reason for that rule.
2. **Write a forward migration.** A migration that undoes the previous one, gone
   through the same review as anything else.
3. **Restore from the Neon branch** the deploy created. Reserved for data
   corruption — it also reverts every legitimate order placed since.

---

## Seeding

| Script              | Purpose                                                 | Safe in production                             |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `db:seed`           | Roles, permissions, settings, shipping rates, tax table | **Yes** — idempotent upserts of reference data |
| `db:seed:catalog`   | Demo products and categories                            | No                                             |
| `db:seed:checkout`  | Demo carts and coupons                                  | No                                             |
| `db:seed:customers` | Demo customer accounts                                  | No                                             |
| `db:seed:admin`     | Demo admin user                                         | No                                             |
| `db:seed:phase7`    | Import templates and job schedules                      | **Yes** — reference data                       |

Only the two marked safe belong in a production runbook, and both are upserts
rather than inserts. Everything else creates test data that is indistinguishable
from real data three months later.

A production database should be seeded **once, before launch**:

```bash
DATABASE_URL="$PRODUCTION_DIRECT_URL" npm run db:seed
DATABASE_URL="$PRODUCTION_DIRECT_URL" npm run db:seed:phase7
```

---

## Query practices

The ones that have actually caused problems here.

**Select what you need.** Prisma returns every scalar column by default. On
`products` that includes the full description on a listing page that shows a
name and a price.

```ts
// 40 columns × 48 products
const products = await prisma.product.findMany({ where, take: 48 });

// 5
const products = await prisma.product.findMany({
  where,
  take: 48,
  select: { id: true, slug: true, name: true, imageUrl: true, priceCents: true },
});
```

**`include` is a join, not a loop — use it.** A `findMany` followed by a
per-item `findUnique` is N+1, and it is invisible until the catalogue grows.

**Batch with `$transaction`.** Independent reads issued together are one round
trip instead of five — which matters far more from a Worker in Sydney than from
a server next to the database.

```ts
const [products, total, facets] = await prisma.$transaction([
  prisma.product.findMany({ where, take, skip }),
  prisma.product.count({ where }),
  prisma.product.groupBy({ by: ['categoryId'], where, _count: true }),
]);
```

**Keep transactions short.** A transaction wrapping an external HTTP call holds
a connection open for the whole round trip. `placeOrder` reserves stock inside a
transaction and calls Klarna outside it, deliberately.

**Cursor pagination for anything deep.** `skip: 10000` makes Postgres read and
discard ten thousand rows. The admin's exports use cursors.

---

## Generated client

```bash
npm run db:generate
```

Output goes to `src/generated/prisma` (set in `schema.prisma`), which is
gitignored and excluded from `tsconfig.json`. It must be regenerated after every
schema change and before every `tsc` run — which is why `prisma generate` is a
step in CI before typechecking, and why `build` is `prisma generate && next
build`.

If types look stale or wrong after pulling a branch, that is almost always the
answer.
