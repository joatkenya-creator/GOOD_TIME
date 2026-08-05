# Post-launch operations

The routine. Most of it is fast, and the point of writing it down is that the
slow-moving failures — a queue that stopped draining, a bounce rate creeping up,
a certificate expiring — are exactly the ones nobody notices without a rhythm.

---

## Daily — five minutes

```
[ ] Sentry: new issues since yesterday, triaged
[ ] /api/health/deep: status ok
[ ] /admin/jobs: dead job count is zero
[ ] Cloudflare DLQ depth is zero
[ ] Yesterday's orders all have a Klarna order id and a matching payment status
[ ] Resend: delivery rate above 95%, bounce rate below 2%
```

**Anything in the Cloudflare DLQ is not a job that failed — it is a delivery
that failed.** Those are infrastructure problems and are worth looking at the
same day; a job whose _work_ failed is `JobStatus.DEAD` and shows in
`/admin/jobs` with a readable error.

The order reconciliation check is the one that catches money problems early. An
order marked `PAID` with no Klarna order id means a push was missed and the
nightly reconcile has not yet run.

---

## Weekly — thirty minutes

```
[ ] Sentry: issue trend. Is anything getting worse rather than just recurring?
[ ] Search Console: coverage errors, Core Web Vitals, manual actions
[ ] Cloudflare: cache hit rate, threats blocked, traffic anomalies
[ ] npm run verify:links against production
[ ] Neon: connection count against the limit, slow query list
[ ] Upstash: request count against the plan, p99 latency
[ ] Klarna Merchant Portal: disputes, and any order stuck in review
[ ] Suppression list growth — a jump means a list-hygiene problem
[ ] Backup: last week's pg_dump exists and is the expected size
[ ] npm audit — anything high or critical
```

A `pg_dump` that is suddenly much smaller is a failed dump that exited zero.
Size is the cheap check that catches it.

---

## Monthly — half a day

```
[ ] Dependency updates (see below)
[ ] npm run lighthouse against production; compare with last month
[ ] Full accessibility pass: npm run test:e2e, plus one manual screen-reader run
[ ] Review WAF rules — is anything blocking legitimate traffic?
[ ] Review rate limits against actual traffic
[ ] Database: unused indexes, sequential scans on large tables
[ ] analytics_events row count and growth rate
[ ] Cloudinary: storage, derived asset count, orphans
[ ] Review admin accounts — remove anyone who has left
[ ] Read the audit log for anything unexpected
[ ] Cost review across Cloudflare, Neon, Upstash, Cloudinary, Resend
```

### Dependency updates

```bash
npm outdated
npm update                    # patch and minor, within ranges
npm audit fix
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

Majors are their own change, one at a time, with the changelog read. The ones
that need care here:

| Package                     | Why                                                  |
| --------------------------- | ---------------------------------------------------- |
| `next`                      | Majors change rendering and caching semantics        |
| `@opennextjs/cloudflare`    | Must stay compatible with the Next major             |
| `prisma` / `@prisma/client` | Must be upgraded together; check migration behaviour |
| `next-auth`                 | Currently a beta — read the release notes every time |
| `wrangler`                  | New compatibility dates can change runtime behaviour |

Update `compatibility_date` in `wrangler.jsonc` deliberately, on staging first.
It gates behaviour changes in the Workers runtime, and moving it is a change
even when nothing else does.

---

## Quarterly — a day

```
[ ] Disaster recovery drill (docs/disaster-recovery.md#the-drill)
[ ] Rotate secrets on the schedule in docs/environment.md
[ ] Review and rotate the Cloudflare API token
[ ] Confirm every production secret is in the password manager
[ ] Review permissions and roles — has anyone accumulated more than they need?
[ ] Re-read the incident log: is anything recurring?
[ ] Update the RPO/RTO numbers with what the drill actually measured
[ ] Review this document — is it still what we do?
```

The drill is the item that gets skipped and the one that matters most. An
untested backup is not a backup, and the discovery that a restore takes four
hours rather than fifteen minutes should not happen during an outage.

---

## Ongoing: performance

Watch, month over month:

| Metric         | Where                          | Alarm           |
| -------------- | ------------------------------ | --------------- |
| LCP, mobile    | Search Console CWV, Lighthouse | > 2.5s          |
| CLS            | Same                           | > 0.1           |
| Worker CPU p99 | Cloudflare                     | Rising trend    |
| Cache hit rate | Cloudflare                     | < 80% on static |
| Database p95   | Neon                           | Rising trend    |
| Bundle size    | CI step summary                | Any jump        |

A single bad number is noise. A trend across three months is a regression
somebody introduced and nobody noticed, and that is the thing this table exists
to surface.

---

## Ongoing: security

| Cadence               | Task                                                      |
| --------------------- | --------------------------------------------------------- |
| Weekly                | `npm audit`; review Cloudflare's blocked-threat summary   |
| Monthly               | Review admin accounts and permissions; read the audit log |
| Quarterly             | Rotate secrets; review WAF rules; review the CSP          |
| On any staff change   | Revoke access the same day                                |
| On any suspected leak | Rotate immediately, then investigate                      |

**Rotate first, investigate second.** A secret that might be leaked costs
minutes to rotate and can cost everything if the investigation is wrong.

---

## Ongoing: database

```sql
-- Table sizes. analytics_events grows fastest by a wide margin.
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;

-- Indexes nobody uses. Each one costs write throughput and disk.
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY relname;

-- Sequential scans on large tables — the usual cause of a slow catalogue.
SELECT relname, seq_scan, seq_tup_read
FROM pg_stat_user_tables WHERE seq_scan > 1000 ORDER BY seq_tup_read DESC;
```

`analytics_events` is trimmed past 400 days by the `analytics.prune` job. If
that job dies, the table does not stop growing — which is one more reason the
daily dead-job check matters.

---

## Ongoing: content and catalogue

```
[ ] Weekly:  products with no image, no description, or missing alt text
[ ] Weekly:  the SEO audit report in /admin/seo
[ ] Monthly: out-of-stock products that should be unpublished
[ ] Monthly: 404s in Search Console — do any need a redirect?
[ ] Monthly: internal linking — are new categories reachable from navigation?
```

---

## Deploy hygiene

- **Small and frequent** beats large and rare. A ten-file deploy that breaks is
  diagnosable; a two-hundred-file one is a bisect.
- **Never on a Friday afternoon**, unless somebody is genuinely available.
- **Staging first, always.** Every production deploy should be an artifact that
  already ran on staging.
- **Watch for ten minutes afterwards.** Sentry and `wrangler tail`. Most bad
  deploys announce themselves immediately.

---

## Escalation

| Situation                | Do                                            |
| ------------------------ | --------------------------------------------- |
| Site down                | Roll back first, diagnose second              |
| Checkout broken          | Page. Revenue is leaving per minute.          |
| Payments not reconciling | Klarna support, with the correlation id       |
| Data corruption          | Stop the writer, then restore to a new branch |
| Suspected breach         | Rotate everything, then investigate           |
| Sustained degradation    | Declare an incident even without an outage    |

The last one is the one people avoid. A site that is slow for six hours costs
more than a site that is down for ten minutes, and it never triggers an alert
because nothing is technically broken.
