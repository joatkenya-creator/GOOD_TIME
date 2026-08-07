# Neon PostgreSQL

The production database. Serverless Postgres with branching, which changes two
things that matter here: how connections work, and what a backup is.

---

## Environment separation

Three environments, one Neon project, separate branches:

| Environment | Neon branch               | Purpose                                          |
| ----------- | ------------------------- | ------------------------------------------------ |
| Development | `dev` (or local Postgres) | A developer's machine. Disposable.               |
| Staging     | `staging`                 | Mirrors production. Real schema, synthetic data. |
| Production  | `main`                    | Real customers.                                  |

One project rather than three because branching is the point: a staging branch
is a copy-on-write clone of production, created in seconds, costing only the
diverged pages. Three separate projects means staging is populated by hand and
therefore never resembles production.

**Staging must never hold real customer data.** A branch from production is a
copy of every email address and every order. Either branch from a sanitised
point, or run the scrub immediately:

```sql
UPDATE users SET
  email      = 'user' || id || '@example.invalid',
  "firstName"= 'Test',
  "lastName" = 'User' || substring(id, 1, 6),
  phone      = NULL;

UPDATE orders SET email = 'order' || id || '@example.invalid';

UPDATE addresses SET
  line1 = '1 Test Street', line2 = NULL, phone = NULL;

TRUNCATE payments, analytics_events RESTART IDENTITY CASCADE;
```

---

## Connection strings

Neon gives two hosts, and the difference is not cosmetic.

```bash
# Pooled — the app. Note the `-pooler` in the hostname.
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Unpooled — migrations only.
DIRECT_DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

### Why the app must use the pooler

Every Cloudflare Worker isolate opens its own connection. Traffic spread across
hundreds of isolates means hundreds of connections, and Postgres' limit is a few
hundred _total_. Without the pooler the site works fine at low traffic and falls
over at exactly the moment it succeeds.

### Why migrations must not

Neon's pooler is PgBouncer in transaction mode. Prisma takes a **session-level
advisory lock** before migrating, so that two concurrent deploys cannot apply
the same migration twice. In transaction mode that lock is released the moment
the statement's transaction ends — so it protects nothing, and two overlapping
deploys can deadlock or double-apply.

This is why `DIRECT_DATABASE_URL` is a production requirement in
[`productionReadiness()`](../src/lib/env.ts) rather than a nicety.

---

## Prisma configuration

```prisma
datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  directUrl         = env("DIRECT_DATABASE_URL")
}
```

`directUrl` is what `prisma migrate` and `prisma db push` use. Everything at
runtime uses `url`.

### Connection parameters worth setting

```
?sslmode=require              # non-negotiable
&connection_limit=1           # see below
&pool_timeout=10
&connect_timeout=10
```

**`connection_limit=1` on Workers.** Prisma's own pool inside an isolate is
pointless — the isolate handles one request at a time, and a pool of ten means
ten idle connections held against Neon's limit per isolate. One connection per
isolate, pooled externally by Neon, is the correct shape.

---

## Autoscaling and autosuspend

| Setting     | Development | Staging | Production   |
| ----------- | ----------- | ------- | ------------ |
| Min compute | 0.25 CU     | 0.25 CU | **1 CU**     |
| Max compute | 1 CU        | 2 CU    | 4 CU         |
| Autosuspend | 5 min       | 5 min   | **Disabled** |

Autosuspend must be off in production. A suspended compute takes several hundred
milliseconds to wake, and that cold start lands on whichever customer arrives
first after a quiet period — reliably, at 3am, and then again on the first
visitor of the morning. It is worth the idle cost not to serve that.

Min compute of 1 CU for the same reason: scaling up from 0.25 is a visible
stall on the first query of a burst.

---

## Backups

Neon's model is **point-in-time restore via branching**, not nightly dumps.

| Plan   | History retention |
| ------ | ----------------- |
| Free   | 24 hours          |
| Launch | 7 days            |
| Scale  | 30 days           |

Anything less than 7 days is not enough for production: the most common
data-loss scenario is a bad migration or a mistaken bulk edit noticed on Monday
that happened on Friday.

### Restore points before every deploy

The production deploy workflow creates a branch before running migrations:

```bash
curl -X POST "https://console.neon.tech/api/v2/projects/$PROJECT/branches" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"branch":{"name":"predeploy-20260804-140000-abc1234","parent_id":"'$MAIN_BRANCH'"}}'
```

Near-instant and near-free, because it is copy-on-write. This is the difference
between a rollback and an incident.

### An independent copy

Branching protects against mistakes. It does not protect against losing the Neon
account, and a backup that lives inside the thing you are backing up is not a
backup. A weekly `pg_dump` to R2 or S3, encrypted, retained for 90 days:

```bash
pg_dump "$DIRECT_DATABASE_URL" --format=custom --no-owner --no-acl \
  | gpg --encrypt --recipient ops@example.com \
  | aws s3 cp - "s3://backups/intimate-bunnie/$(date +%Y-%m-%d).dump.gpg"
```

Full procedure and the restore drill in
[disaster-recovery.md](./disaster-recovery.md).

---

## Restoring

### Point-in-time, to a new branch

```bash
# Branch from production as it was at a moment in time.
curl -X POST "https://console.neon.tech/api/v2/projects/$PROJECT/branches" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"branch":{"name":"recovery","parent_id":"'$MAIN'","parent_timestamp":"2026-08-04T12:00:00Z"}}'
```

**Always restore to a new branch first.** Inspect it, confirm it holds what you
expect, and only then repoint the application. Restoring in place destroys the
evidence of what went wrong along with the problem.

Promoting the recovery branch is a connection-string change: set
`DATABASE_URL`/`DIRECT_DATABASE_URL` to the new branch's endpoints and redeploy.

### Recovering specific rows

Usually better than a full restore. Branch to a recovery endpoint, then copy
across with `postgres_fdw` or a scripted read-and-insert — a full restore also
reverts every legitimate order placed since the incident.

---

## Monitoring

In the Neon console:

- **Connection count** against the limit — the number that predicts an outage
- **Compute time** — a sudden rise means a query lost its index
- **Data transfer** — a rise usually means a `SELECT *` that should be a
  projection
- **Slow queries** — `pg_stat_statements` is enabled by default

Surfaced in the app by `/api/health/deep`, which reports database latency and
whether the connection is reachable at all.

### Queries worth keeping

```sql
-- Slowest by total time. Total, not mean: a 40ms query run a million times
-- costs more than a 5s query run twice.
SELECT calls, round(total_exec_time::numeric, 0) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Indexes nobody uses. Every one costs write throughput and disk.
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY relname;

-- Sequential scans on large tables — the usual cause of a slow catalogue.
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_tup_read DESC;
```

---

## Practices worth keeping

- **Never `prisma db push` against production.** It applies the schema with no
  migration record, so the next `migrate deploy` sees drift it cannot resolve.
- **Never edit an applied migration.** Prisma checksums them; an edited one
  fails every subsequent deploy. Write a new migration.
- **Read replicas** are available on Scale for reporting. The admin's analytics
  queries are the natural candidate — they are heavy, tolerant of lag, and
  currently compete with the storefront.
- **Watch for row growth in `analytics_events`.** It is the fastest-growing
  table by a wide margin. The `analytics.prune` job trims it past 400 days; if
  that job dies, the table does not stop growing.
