# Backup and disaster recovery

What is backed up, how to get it back, and what to do while it is happening.

---

## Recovery objectives

|                                       | Target       | Achieved by                                 |
| ------------------------------------- | ------------ | ------------------------------------------- |
| **RPO** — data you can afford to lose | ≤ 1 minute   | Neon point-in-time restore                  |
| **RTO** — time to be serving again    | ≤ 15 minutes | Worker rollback, or a Neon branch promotion |

Both assume somebody is available and knows this document exists. That second
assumption is the one that fails, which is why the [drill](#the-drill) is
scheduled rather than aspirational.

---

## What is backed up, and by whom

| Asset           | Mechanism                          | Retention         | Recovers from                          |
| --------------- | ---------------------------------- | ----------------- | -------------------------------------- |
| Database        | Neon point-in-time                 | 7–30 days by plan | Bad migration, bad bulk edit, deletion |
| Database        | Weekly `pg_dump` to object storage | 90 days           | Losing the Neon account                |
| Product imagery | Cloudinary auto-backup to S3/R2    | 90 days           | Losing the Cloudinary account          |
| Code            | Git, GitHub                        | Forever           | Everything                             |
| Secrets         | Password manager                   | —                 | A rotated secret nobody recorded       |
| Worker versions | Cloudflare, last 10                | —                 | A bad deploy                           |

Two things on that list are commonly missing and both are single points of
failure:

- **Cloudinary auto-backup is off by default.** Enable it (Settings → Backup).
  Losing the account otherwise loses every product image, and the database only
  holds `public_id`s pointing at nothing.
- **Neon branching is not an off-site backup.** A backup living inside the thing
  it backs up does not protect against losing that thing. The weekly dump is the
  independent copy.

---

## Database

### Restore points

Every production deploy creates a Neon branch before running migrations
(see [`deploy.yml`](../.github/workflows/deploy.yml)). Copy-on-write, so it is
near-instant and near-free — and it is the difference between a rollback and an
incident.

### Point-in-time restore

```bash
curl -X POST "https://console.neon.tech/api/v2/projects/$PROJECT/branches" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"branch":{
        "name":"recovery-20260804",
        "parent_id":"'$MAIN_BRANCH'",
        "parent_timestamp":"2026-08-04T12:00:00Z"
      }}'
```

**Always restore to a new branch first.** Inspect it, confirm it holds what you
expect, and only then repoint the application. Restoring in place destroys the
evidence of what went wrong along with the problem.

Promoting is a connection-string change:

```bash
wrangler secret put DATABASE_URL --env production          # recovery branch, pooled
wrangler secret put DIRECT_DATABASE_URL --env production   # recovery branch, direct
npm run cf:deploy
```

### Recovering specific rows

Usually better than a full restore, because a full restore also reverts every
legitimate order placed since the incident.

```sql
-- On the recovery branch, from the production database:
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER recovery FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'ep-recovery.neon.tech', dbname 'neondb');
-- ... user mapping, IMPORT FOREIGN SCHEMA, then copy the rows you need.
```

### The weekly dump

```bash
pg_dump "$DIRECT_DATABASE_URL" --format=custom --no-owner --no-acl \
  | gpg --encrypt --recipient ops@example.com \
  | aws s3 cp - "s3://backups/good-time/$(date +%Y-%m-%d).dump.gpg"
```

Encrypted, because it contains every customer's email address and order history.
Restore:

```bash
aws s3 cp "s3://backups/good-time/2026-08-04.dump.gpg" - \
  | gpg --decrypt \
  | pg_restore --dbname "$TARGET_URL" --no-owner --clean --if-exists
```

---

## Media

Cloudinary is the system of record for imagery, and the database stores every
`public_id`. So the mapping survives independently — what needs backing up is
the bytes.

With auto-backup enabled, recovery is a re-upload from the backup bucket using
the stored `public_id`s. Without it, there is no recovery.

Deleting a `Media` row deliberately does **not** delete the Cloudinary asset.
An accidental product deletion is recoverable while the asset survives and
unrecoverable once it does not; orphans are collected on a 30-day delay, which
is the window in which somebody notices.

---

## Rollback procedures

### Bad deploy, database unchanged

```bash
wrangler deployments list --env production
wrangler rollback --env production --message "reverting <sha>"
```

Seconds. Repoints traffic at a version already on the edge.

### Bad deploy, migration applied

The Worker rolls back; the migration does not. This works **because migrations
are expand-only** — never drop a column in the same release that stops using it.
See [prisma.md](./prisma.md#expand-and-contract).

If the migration itself is the problem, write a forward migration. There is no
`prisma migrate down`, and a hand-written one that drops a column also drops the
data written since.

### Data corruption

1. **Stop the bleeding.** If a job or an integration is corrupting rows,
   disable it before restoring — otherwise the restore is corrupted too.
2. Restore to a **new** Neon branch at a timestamp before the corruption.
3. Compare. Decide whether to promote the branch or to copy specific rows.
4. Promote or copy.
5. Reconcile payments: `syncFromKlarna` for anything in flight, because Klarna's
   record is authoritative and will not have been restored.

### Total Cloudflare outage

There is no failover, and pretending otherwise would be worse than saying so.
The mitigation is that Cloudflare's own redundancy is better than anything a
shop this size would build, and the DNS TTL is low enough to move if it ever
came to that.

---

## Incident response

### 1. Declare

Anyone can. The cost of an unnecessary declaration is a Slack message; the cost
of a delayed one is measured in orders.

Post in `#incidents`:

```
INCIDENT: checkout returning 500
Started: ~14:20 UTC
Impact:  customers cannot complete orders
Lead:    @name
```

### 2. Stabilise before diagnosing

Roll back first if a deploy is even plausibly implicated. Diagnosis with the
site up is calmer and more accurate than diagnosis with revenue leaving.

### 3. Communicate

- Under 15 minutes: no external statement needed.
- Over 15 minutes: a status message on the site.
- Payments affected: say so explicitly. A customer who cannot tell whether they
  were charged will try again, and duplicate authorisations are worse than the
  original outage.

### 4. Checklist

```
[ ] /api/health from outside
[ ] /api/health/deep — which subsystem
[ ] Sentry, last hour
[ ] wrangler tail --status error
[ ] Status pages: Cloudflare, Neon, Upstash, Klarna, Resend
[ ] wrangler deployments list — did we deploy?
[ ] Rolled back if a deploy is implicated
[ ] Stakeholders told
[ ] Customer-facing message if > 15 min
```

### 5. Afterwards

Within 48 hours, blameless, written down:

- Timeline: when it started, when it was noticed, when it was fixed
- Root cause, and the cause of _that_
- Why it was not caught — the more useful question than what broke
- What changes: a test, an alert, a guard rail. **One concrete action with an
  owner and a date.**

"Be more careful" is not an action. If the answer is that nothing could
reasonably have caught it, write that down too — it is a real answer, and it
stops the next review re-deriving it.

---

## The drill

Untested backups are not backups. **Quarterly**, in staging:

```
[ ] Restore a Neon branch to a point in time.  Time it.
[ ] Verify: order count, latest order, a customer login works.
[ ] Roll back a Worker deployment.  Time it.
[ ] Restore one image from the Cloudinary backup.
[ ] Decrypt and restore last week's pg_dump into a scratch database.
[ ] Confirm every secret in production is recorded in the password manager.
[ ] Update the RPO/RTO numbers at the top of this file with what was measured.
```

That last line is the point. Numbers that were never measured are aspirations,
and an incident is a poor time to discover the difference.

---

## Contacts

Keep current. A support tier nobody knows about is a support tier you do not
have.

|                  |                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| Cloudflare       | dash.cloudflare.com → Support                                                         |
| Neon             | console.neon.tech → Support (paid plans get a response SLA)                           |
| Upstash          | support@upstash.com                                                                   |
| Klarna           | Merchant Portal → Support. **Have the correlation id** — it is on every `KlarnaError` |
| Resend           | support@resend.com                                                                    |
| Cloudinary       | support.cloudinary.com                                                                |
| Domain registrar | _(record it here)_                                                                    |
