# Background processing

Cloudflare Queues for delivery, Postgres for state.

---

## The split, and why it is not a compromise

It would have been possible to replace `background_jobs` with Cloudflare Queues
outright. That would have cost, all at once:

- enqueuing a reindex **in the same transaction** as the product write;
- the admin's job screen;
- a dead-letter list an operator can read and requeue from;
- the dedupe key that collapses four hundred reindex requests into one;
- the retry history that answers "why did this import fail three times".

So:

> **Postgres owns state. Cloudflare Queues owns latency.**

1. `enqueue()` writes the row, transactionally, exactly as before.
2. `cf-queue.ts` then publishes the **job id** — nothing else — to a queue.
3. The consumer in `cloudflare/worker.ts` claims that job and runs it.

The message is a pointer, not a payload. If it is lost, duplicated, delivered
late or delivered twice, the database is still correct: the job is claimed with
`FOR UPDATE SKIP LOCKED`, so a duplicate claims nothing, and the every-minute
cron sweep picks up anything the queue dropped.

**Losing the queue degrades latency from seconds to a minute. It never loses
work.** That is what makes it safe for `publish` to swallow its own failures
rather than failing the customer-facing write that triggered it.

---

## Three ways a job runs

| Path      | Trigger                                 | Latency  | Role                                      |
| --------- | --------------------------------------- | -------- | ----------------------------------------- |
| **Push**  | `enqueue` → Cloudflare Queue → `runOne` | 1–2s     | Normal production path                    |
| **Sweep** | Cron `* * * * *` → `drain`              | ≤60s     | The floor that makes push allowed to fail |
| **Loop**  | `npm run worker`                        | ~2s poll | Containers, and local development         |

Same handlers in all three. Only the loop differs.

---

## Two queues

| Queue             | Binding       | Why separate                                                                |
| ----------------- | ------------- | --------------------------------------------------------------------------- |
| `good-time-jobs`  | `JOB_QUEUE`   | Everything else                                                             |
| `good-time-email` | `EMAIL_QUEUE` | A ten-thousand-row import must not delay a password reset by twenty minutes |

Routing is by kind prefix: anything starting `email.` goes to the email queue.

---

## Job kinds

| Kind                 | Purpose                           | Schedule     |
| -------------------- | --------------------------------- | ------------ |
| `import.run`         | Supplier product import           | On demand    |
| `price.sync`         | Pull supplier prices              | `0 2 * * *`  |
| `inventory.sync`     | Pull supplier stock               | `0 3 * * *`  |
| `inventory.alerts`   | Low-stock admin alerts            | `0 * * * *`  |
| `media.optimize`     | Cloudinary derivatives            | On upload    |
| `search.index`       | Reindex one product               | On write     |
| `search.reindex_all` | Rebuild the index                 | On demand    |
| `seo.audit`          | Crawl for metadata problems       | `0 4 * * 1`  |
| `seo.regenerate`     | Drop sitemap and catalogue caches | `30 4 * * *` |
| `cache.invalidate`   | Drop a tag                        | On write     |
| `email.send`         | Transactional email               | On demand    |
| `analytics.rollup`   | Aggregate raw events              | `15 0 * * *` |
| `analytics.prune`    | Delete events past 400 days       | `0 5 1 * *`  |
| `jobs.prune`         | Delete succeeded jobs past 7 days | `0 5 * * 0`  |

---

## Retries

Two independent layers, doing different jobs. Conflating them causes double
execution.

### The database's retry — for work that failed

Exponential backoff with jitter, five attempts, then `JobStatus.DEAD`.

The jitter is not decoration: a supplier API that 500s takes every job with it,
and without jitter all of them retry in the same second and knock it over again
the moment it recovers.

### The queue's retry — for delivery that failed

Three attempts, then Cloudflare's DLQ.

The consumer **acks a job whose handler failed**, because the database has
already scheduled that retry with proper backoff — retrying the message as well
would run it twice at once. `retry()` is reserved for the case where the
consumer could not reach the database at all.

### Two dead-letter queues, two meanings

|           | Cloudflare DLQ                  | `JobStatus.DEAD`                         |
| --------- | ------------------------------- | ---------------------------------------- |
| Means     | _Delivery_ failed repeatedly    | _Work_ failed repeatedly                 |
| Cause     | Consumer crashed, isolate OOMed | Bad data, broken integration, a bug      |
| Job row   | Usually still `QUEUED`          | `DEAD`, with `lastError`                 |
| Where     | Cloudflare dashboard            | `/admin/jobs`                            |
| Should be | **Empty**                       | Occasionally non-empty; investigate each |

Conflating them is how a deploy bug gets misdiagnosed as a bad import file.

---

## Idempotency

**Every handler must be idempotent.** Not a style preference — three separate
mechanisms can deliver the same job twice:

- Cloudflare Queues is at-least-once by design.
- `reclaimStale` returns jobs from a crashed worker that may have half-finished.
- The cron sweep and a queue message can race for the same row.

`claimById` guards with `status = 'QUEUED'` inside the UPDATE, so the second
claim matches no rows and returns `'gone'`, which is acked. The database is what
makes the delivery guarantee harmless.

---

## Dedupe keys

```ts
await enqueue({
  kind: 'search.index',
  payload: { productId },
  dedupeKey: `search.index:${productId}`,
});
```

A bulk edit touching four hundred products wants each reindexed once, not once
per save. The upsert only revives a job that has already **finished** — a queued
or running job with the same key _is_ the work already happening, and touching it
would either duplicate it or reset a running job's attempt count.

---

## Monitoring

### Depth is the wrong number

A thousand jobs draining in a minute is a busy shop. Ten that have been waiting
an hour means the workers are dead, and depth alone cannot tell those apart.

**`oldestQueuedSeconds` is the number to alert on.**

| Metric                | Healthy | Alert            |
| --------------------- | ------- | ---------------- |
| `oldestQueuedSeconds` | < 60    | > 300            |
| `dead`                | 0       | > 0              |
| Cloudflare DLQ depth  | 0       | > 0              |
| Cloudflare backlog    | near 0  | sustained growth |

`/api/health/deep` reports all of these, and `/admin/jobs` is the screen for
requeuing.

### Tailing

```bash
wrangler tail --env production --format pretty | grep -E 'job\.|queue\.'
```

---

## Cron triggers

Declared in `wrangler.jsonc`, handled in `cloudflare/worker.ts`. **Each entry
needs a matching branch**; one without a branch falls into `default` and reports
itself to Sentry rather than silently doing nothing.

| Schedule       | Does                                                      |
| -------------- | --------------------------------------------------------- |
| `* * * * *`    | Drain the queue, fire due schedules, reclaim crashed jobs |
| `*/15 * * * *` | Return stock held by abandoned checkouts                  |
| `0 6 * * *`    | Extend Klarna authorisations approaching expiry           |

The application's own scheduler (`tickScheduler`, driven by `ScheduledJob` rows)
runs inside the one-minute sweep. Cron triggers are the outer clock; the
database table is what makes a schedule editable in the admin without a deploy.

---

## Local development

`next dev` has Cloudflare bindings injected (see `next.config.ts`), so
`publish()` works. Under plain `vitest` or a `tsx` script there is no binding,
`publish` returns `false`, and everything falls back to the sweep.

To run jobs locally without waiting for a sweep:

```bash
npm run worker
```

To exercise the real consumer, including batching and acking:

```bash
npm run cf:preview
npx wrangler queues consumer add good-time-jobs --local   # if not already bound
```

---

## Adding a job kind

1. Register the handler in [`lib/jobs/handlers.ts`](../src/lib/jobs/handlers.ts).
2. Make it idempotent. Assume it will run twice.
3. Report progress via `context.progress()` if it is long — otherwise the admin
   shows a job that has been "running" for eleven minutes with no sign of life.
4. Add it to `DEFAULT_SCHEDULES` if it is periodic.
5. Route it to `EMAIL_QUEUE` if it is latency-sensitive and small.

Keep payloads small and free of secrets: `background_jobs.payload` is readable
in the admin and included in every database backup.
