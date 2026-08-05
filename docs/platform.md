# Platform

Phase 7: ingestion, background work, search, analytics, caching and monitoring.
What each subsystem does, and the decisions that are not obvious from the code.

---

## Background jobs

### Postgres, not Redis

The only genuinely hard part of a queue is claiming a job exactly once when
several workers race for it. Postgres solves that in one statement —
`SELECT … FOR UPDATE SKIP LOCKED` — and the database is already in the stack,
already backed up, already monitored, and already transactional with the data
the jobs are about.

That last point is the one that decides it. Enqueuing a reindex _in the same
transaction_ as the product write is impossible with an external broker and
free here: either the product saved and its reindex is queued, or neither
happened. With Redis there is always a window where one succeeded and the other
did not.

A dedicated broker earns its operational cost somewhere north of a few thousand
jobs per second. A hundred thousand products re-priced nightly is roughly one
per second. The seam is `enqueue`/`claim` in [`lib/jobs/queue.ts`](../src/lib/jobs/queue.ts) — the day the
numbers change, that is where SQS or BullMQ slots in without touching a handler.

### Two ways to run it

|            | Command                                       | When                         |
| ---------- | --------------------------------------------- | ---------------------------- |
| Serverless | Cron calls `POST /api/cron/jobs` every minute | Vercel; nothing to keep warm |
| Container  | `npm run worker`                              | A VM or a container platform |

Same handlers, same queue; only the loop differs. Run one or the other — both
is harmless (the queue claims exactly once) but pays for an idle container
beside a cron that already drains it.

### The failure model

Retries are exponential **with jitter**. The jitter is not decoration: a
supplier API that 500s takes every job with it, and without jitter all of them
retry in the same second and knock it over again the moment it recovers.

A job that exhausts `maxAttempts` becomes `DEAD` rather than being deleted. The
dead-letter queue is a status, not a second table, because what an operator
wants is "show me what failed and let me requeue it" — one filter away.

A worker that crashes mid-job leaves a stale lock. `reclaimStale` finds those by
age and requeues them. **Every handler must therefore be idempotent**: at worst
something runs twice, and running twice must equal running once.

### Alert on age, not depth

`oldestQueuedSeconds` is the number that matters. A thousand jobs draining in a
minute is a busy shop; ten that have waited an hour means the workers are dead.
Depth alone cannot tell those apart.

---

## Product import

### The pipeline

```
fetch → parse → normalise → validate → reconcile → persist
```

Only the first two steps differ per source. An adapter's whole job is to turn
bytes into `Record<string, string>[]`; everything downstream is shared. That
boundary is what stops the fifth supplier arriving as a fifth bespoke script.

| Source                          | Parser          | Notes                                                                   |
| ------------------------------- | --------------- | ----------------------------------------------------------------------- |
| CSV / TSV                       | Hand-written    | RFC 4180 is four rules; a dependency here is 300KB to avoid 40 lines    |
| Excel                           | ExcelJS         | The one format worth a dependency — zip + shared strings + serial dates |
| XML / Google Merchant           | fast-xml-parser | Item element detected, not configured                                   |
| JSON / Supplier API / Affiliate | Native          | Array found under any conventional key                                  |

**Why ExcelJS and not SheetJS**: the `xlsx` package on npm is the abandoned
build — upstream moved distribution to their own CDN and the npm copy carries
unpatched advisories.

### Three rules that govern every import

1. **Imported products arrive as drafts.** A feed is a proposal, not a
   merchandising decision. Publishing on import means a supplier's typo is live
   before anyone has seen it — and in this category an unreviewed product
   description is a brand risk, not a typo.
2. **An import never deletes.** The worst a feed can do is deactivate. A
   supplier who ships a truncated file on a bad day would otherwise wipe the
   catalogue, and no validation catches "legitimately formatted, legitimately
   missing 9,000 products".
3. **Every row is recorded, including the ones that did nothing.** `ImportRow`
   stores a before-image per row, which is what makes rollback possible at all.

### Conflict policy

A supplier feed is not automatically more correct than a merchandiser's copy.

| Policy        | Behaviour                                                      |
| ------------- | -------------------------------------------------------------- |
| `fill_blanks` | Existing values win; only empty fields are filled              |
| `overwrite`   | Feed wins for mapped fields                                    |
| `flag`        | Records the difference, changes nothing, leaves it for a human |

### Money never touches a float

`parseFloat("19.99") * 100` is `1998.9999999999998`. `moneyToCents` splits on
the separator and pads the fraction, which is exact for every input a feed can
contain — including `19,99`, `1.234,56` and `$1,234.56`.

### Price sync refuses implausible changes

A price that moves more than 50% is **refused and alerted**, not applied. That
is the signature of a broken feed — a currency column that changed units, a
decimal separator misread, a supplier exporting cost instead of retail. The
whole point of automation is that nobody is watching.

### Stock always goes through the ledger

The importer writes `StockAdjustment` rows exactly as a manual adjustment does.
An importer that wrote `quantity` directly would be the one path where inventory
changed with no record of why — the hole the ledger exists to close.

---

## Search

### Postgres first, deliberately

`tsvector` with a GIN index does stemming, ranking, phrase and prefix matching;
`pg_trgm` adds typo tolerance. That covers the whole brief up to roughly a
hundred thousand documents, with no second service to run, secure, back up or
**keep in sync** — and keeping in sync is where most search deployments actually
fail.

`SearchEngine` in [`services/search/engine.ts`](../src/services/search/engine.ts) is the seam. The trigger to
cross it is measurable rather than theoretical: **p95 search latency over ~200ms**,
or the catalogue past a few hundred thousand documents. Meilisearch or
OpenSearch then implements the same five methods against the same
`ProductSearchDocument` rows.

### Ranking is weighted

A term in the title means far more than the same term buried in a description,
and Postgres cannot know that alone. Title weight ×4, brand ×2, body ×1, plus a
bonus for a prefix match on the title. Without it, "silicone" returns three
hundred products whose care instructions mention silicone, ahead of the one
called _Silicone Wand_.

### Cold start is the real latency, not the query

Measured against Neon from a remote client:

|                                            |                              |
| ------------------------------------------ | ---------------------------- |
| Query execution (`EXPLAIN ANALYZE`)        | **1.9 ms**                   |
| Warm round trip to the database            | ~230 ms                      |
| Warm search, end to end                    | ~240 ms — **one round trip** |
| Search with a fresh term (facets uncached) | ~730 ms — three round trips  |
| **First query on a cold connection**       | **~2200 ms**                 |

The query itself is not the cost and never was; the network is, and a cold
serverless connection dominates everything. In production the pool is warm
within seconds of the first visitor, but a deployment that idles — a preview
environment, a low-traffic region — pays that ~2.2s on its first request.

That is worth knowing before anyone optimises the query. Chasing an absolute
latency number here measures the distance to the database, so
`verify:operations` asserts a _ratio_ against a measured round trip instead.

### Typo tolerance runs only on zero results

Trigram similarity is far more expensive than a GIN lookup. Running it on every
query to help the one-in-fifty that is misspelled is the wrong trade; running it
only when the exact search found nothing costs nothing on the happy path.

### Synonyms are curated, and one-way matters

No algorithm knows that this category's shoppers say "wand" and mean one
specific shape. One-way means searching _vibrator_ also finds bullets, without
searching _bullet_ returning every vibrator in the catalogue.

---

## Analytics

### Why first-party alongside GA4

GA4 is blocked by roughly a third of visitors, sampled above a threshold, and
owned by someone else. For a shop in this category that is worse than usual: the
privacy-conscious are exactly the people most likely to block it, so the missing
third is not random — it is the segment most worth understanding.

`AnalyticsEvent` is written from the server, where nothing can block it, and
keeps working with every tag switched off.

### What is deliberately not collected

No fingerprint, no cross-site identifier, no IP address, no raw user agent. The
session id is a **rotating cookie value hashed with a server secret**, so the
stored value cannot be correlated back by anyone reading the table. Device is
three buckets; country is a two-letter code.

That is a practical position as much as an ethical one: this shop sells intimate
products, and a detailed browsing profile tied to an identity is a liability the
business should not want to hold. What cannot be leaked is what was never stored.

### Rollups, not raw scans

A dashboard scanning ten million rows works until it does not — and ten million
is a few weeks of a busy shop. `AnalyticsDaily` holds one row per day per
metric; the dashboard reads those, so its cost stays flat.

The schedule re-runs **yesterday as well as today**, because events arriving late
would otherwise be counted in no day at all.

### Sessions, not events

The funnel counts distinct sessions per step. Counting events reports conversion
above 100% and teaches everyone to distrust the dashboard.

### Money comes from orders

Revenue and lifetime value are read from the orders table, never from events.
Analytics is best-effort — a blocked request, a tab closed mid-beacon — and
revenue reporting has to reconcile with what was actually charged.

---

## Caching

`REDIS_URL` set → Redis. Unset → an in-process LRU. Every call site is identical
either way, so a single instance runs with no extra service and a fleet gets a
shared cache by setting one variable.

The fallback is a real cache, not a stub — but it does not pretend to be shared:
`invalidate` on one instance cannot clear another's memory, which is why entries
carry short TTLs and why anything correctness-critical uses the database.

Two layers, easily confused, wrapped with names that say which:

|                       | What                                                  |
| --------------------- | ----------------------------------------------------- |
| `lib/cache/cached.ts` | Next's data cache — page data, tag-invalidated        |
| `lib/cache/store.ts`  | Everything else — facet counts, synonym tables, feeds |

---

## SEO

### Sitemaps

| File                    | Contents                                      |
| ----------------------- | --------------------------------------------- |
| `/sitemap.xml`          | Pages, categories, products (existing)        |
| `/sitemap-index.xml`    | The index to submit to Search Console         |
| `/sitemap-images-N.xml` | Product images, paginated at 45,000           |
| `/sitemap-videos.xml`   | Empty but valid until the library holds video |
| `/sitemap-news.xml`     | Last 48 hours of posts, correct structure     |

A sitemap caps at 50,000 URLs. At a hundred thousand products that is three
files plus an index, which is why pagination exists before it breaks.

### The Merchant feed omits what it cannot state truthfully

A product with no image, price or description is **skipped** rather than
submitted with blanks. Merchant Center rejects those anyway, and a feed with a
40% rejection rate buries the items that genuinely need fixing.

Every item is submitted `adult: yes` unless explicitly marked otherwise. Getting
that wrong risks the whole account, not one listing.

### Structured data describes what is on the page

Marking up a rating that is not displayed, or an offer at a price the customer
will not be charged, is a manual-action risk and a lie told to a machine on the
shop's behalf. `aggregateRatingSchema` returns null below three reviews for the
same reason.

`LocalBusiness` returns null until a real address is configured — for this
category, publishing an unverified address may publish a private residence.

### The audit runs on the database, not a crawl

Crawling a hundred thousand pages to learn that four hundred lack a meta
description takes hours to discover what one query already knows. Findings are
graded CRITICAL / WARNING / NOTICE, because a checker reporting six thousand
equally-weighted problems gets read once.

---

## Marketing

Every advertising tag is a third party watching someone browse intimate
products. So:

- Default **off**, default **`requiresConsent: true`**.
- Tags requiring consent are **not rendered into the DOM at all** until consent
  is recorded — not blocked-then-unblocked, not `type="text/plain"`. A script
  on the page is a script that can run.
- The server snapshot is `null`, so a visitor who refused is never even told
  which trackers exist.

GA4 is the one defensible early load: in Google's consent mode it sets no
cookies and sends no identifiers until consent arrives.

Only **public identifiers** live in the database — a measurement id is emitted
into the page anyway. API secrets stay in the environment.

---

## Images

Almost no work happens in this codebase, and that is the design. Cloudinary does
format negotiation, resizing and compression at the edge; re-implementing that
with `sharp` means holding a 20MB TIFF in a serverless function to produce
something worse than a URL parameter.

- `f_auto` — AVIF to Chrome, WebP to older browsers, JPEG to the rest, from one
  URL. No `<picture>` element to go stale.
- `q_auto` — quality per image by content. Beats a fixed number in both
  directions.
- Six widths, chosen from the layout's real breakpoints. Every extra width is
  another derivative to generate and pay for.
- Duplicates detected by **content hash** before upload — the same photo arrives
  from three suppliers as `IMG_4821.jpg`, `main.jpg` and `SKU-1234-1.jpg`.

---

## Monitoring

No SDK is wired in. Sentry and OpenTelemetry are deployment decisions: hard-wiring
either means every environment carries its bundle and network behaviour,
including local development and CI.

[`lib/monitoring/metrics.ts`](../src/lib/monitoring/metrics.ts) defines the seams — `increment`, `observe`,
`startSpan`, `captureError` — which log by default. Wiring Sentry is three
function bodies in one file; nothing that calls them changes. Output is
Prometheus text format, which Prometheus, the OTel collector, Datadog and Grafana
Agent all ingest.

**Labels must be low-cardinality.** A status code, a route template, a job kind —
never a product id. One label with a million values is a million series.

---

## Security

| Threat               | Defence                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Zip bomb             | Compression ratio checked before extraction                        |
| Formula injection    | `=`, `+`, `-`, `@` prefixed on CSV export                          |
| Disguised executable | Magic bytes checked against the claimed extension                  |
| SSRF via feed URL    | HTTPS only; loopback, private ranges and `169.254.169.254` refused |
| Webhook forgery      | HMAC compared with `timingSafeEqual`                               |

Formula injection deserves emphasis: supplier data flows into our exports, so
without neutralisation a hostile feed can plant `=cmd|'/c calc'!A1` in a product
name and have it execute on the merchant's machine. The shop becomes the courier.

---

## Verification

```bash
npm run verify:platform     # 68 checks: money, CSV, XML, mapping, security, cron, queue
```

The queue section runs the check that matters most — two workers claiming
concurrently must never receive the same job. Without `FOR UPDATE SKIP LOCKED`
they do, and an import runs twice, creating every product twice.

---

## Not built

- **A real external search engine.** The interface exists; Postgres serves the
  catalogue at its current and projected size.
- **Video.** Sitemap and schema shapes exist; the media library stores images.
- **Google News.** The sitemap is correct; acceptance into Google News is a
  business decision.
- **A metrics backend.** Prometheus output exists; nothing scrapes it yet.
- **`sharp`-based local image processing.** Cloudinary does it better at the edge.
