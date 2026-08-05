# Monitoring and observability

What tells you something is wrong, and what tells you what.

---

## The layers

| Layer   | Tool                              | Answers                                  |
| ------- | --------------------------------- | ---------------------------------------- |
| Errors  | Sentry                            | What broke, where, for whom, since when  |
| Metrics | `lib/monitoring/metrics.ts`       | How often, how slow                      |
| Logs    | `wrangler tail` / Workers Logs    | What happened in this one request        |
| Edge    | Cloudflare Analytics              | Traffic, cache hit rate, blocked threats |
| Uptime  | External monitor                  | Is it up _from outside_                  |
| Health  | `/api/health`, `/api/health/deep` | Which subsystem is degraded              |

The last row is the one people skip and then wish they had. Cloudflare being up
and the Worker returning 200 says nothing about whether Upstash is reachable or
whether the job queue has been stalled for an hour.

---

## Sentry

### Why the envelope API rather than `@sentry/nextjs`

The official SDK instruments the Node runtime — `async_hooks`, a monkey-patched
`http`, a build-time webpack plugin. None of that exists in the Workers runtime,
so using it means adding `@sentry/cloudflare` as well, wiring a second init path,
and carrying ~90 KB into an isolate billed on CPU time.

What is actually needed from Sentry is an exception with a stack trace, tags,
request context and correct grouping. That is one POST to a documented, stable,
versioned endpoint. [`lib/monitoring/sentry.ts`](../src/lib/monitoring/sentry.ts)
is the whole client, works identically in Node and Workers, and costs nothing
when `SENTRY_DSN` is unset.

Swap in the SDK the day distributed tracing and session replay are worth the
weight. `captureException` is the only function anything calls, so it is a
one-file change.

### Configuration

```bash
SENTRY_DSN=https://key@o123.ingest.sentry.io/456
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git sha>          # set by CI
SENTRY_TRACES_SAMPLE_RATE=0.1
NEXT_PUBLIC_SENTRY_DSN=...        # a separate project key for the browser
```

Two DSNs on purpose. Browser errors are dominated by extension noise, ad
blockers and bots; a flood of them in the same project drowns the server events
that mean something.

### Grouping

The one thing that decides whether Sentry is useful or ignored.

Without a fingerprint, `Order GT-100042 not found` and `Order GT-100043 not
found` are two issues — then two thousand, and the one alert that mattered is
buried. So `withRoute` fingerprints by route:

```ts
fingerprint: ['route', request.method, request.nextUrl.pathname];
```

Stack frames are parsed and sent for the same reason: without them Sentry groups
by message alone, and `in_app` is what makes it show our code rather than forty
frames of framework internals.

### What never leaves

Request headers go through an **allowlist**: `user-agent`, `referer`,
`accept-language`, `cf-ray`, `cf-ipcountry`. A denylist is one new header away
from shipping a session cookie to a third party, and `tests/monitoring.test.ts`
asserts a cookie and an authorization header never appear in the payload.

### Flushing

An isolate can be frozen the instant a handler returns, and an in-flight report
is simply lost — the failure mode that makes people think error reporting "works
sometimes". So sends are tracked and `flush()` is awaited at every boundary: the
queue consumer, the scheduled handler, and the error path of a route.

`flush` is bounded (default 2s) because flushing must not itself become the
thing that times out.

### Alerts

| Condition                                | Route to           |
| ---------------------------------------- | ------------------ |
| New issue in `production`                | Slack, immediately |
| Any issue tagged `route:/api/checkout`   | Page               |
| Any issue tagged `route:/api/webhooks/*` | Page               |
| Error rate > 10× the hourly baseline     | Page               |
| Issue regression (resolved, now back)    | Slack              |

Checkout and webhooks page rather than notify. Everything else can wait for
someone to read Slack; a broken checkout is revenue leaving per minute, and a
broken webhook is orders silently not being marked paid.

---

## Metrics

[`lib/monitoring/metrics.ts`](../src/lib/monitoring/metrics.ts) is an in-process
counter and histogram store, exposed at `/api/health/deep` and in Prometheus
format via `toPrometheus()`.

**It is per-isolate.** On Workers that makes it a sample, not a total —
genuinely useful for "is this route slow" and useless for "how many orders
today". Anything that has to be counted exactly is counted in Postgres.

Worth watching:

| Metric               | Meaning                                                |
| -------------------- | ------------------------------------------------------ |
| `errors.total{type}` | Errors by class — "errors are up" without a log search |
| `email.event{type}`  | Delivered, bounced, complained                         |
| `span.*`             | Duration of instrumented operations                    |

---

## Logs

```bash
wrangler tail --env production --format pretty
wrangler tail --env production --status error
wrangler tail --env production --search "klarna"
```

Logging is structured JSON in production and plain text in development
([`lib/logger.ts`](../src/lib/logger.ts)). Cloudflare Workers Logs ingests the
JSON and makes the fields searchable, which is why every log line is an event
name plus fields rather than a sentence.

`observability.head_sampling_rate` is 1.0 in `wrangler.jsonc`. Sampling saves
money on logs nobody reads; the whole point is that the one broken checkout is
in there.

### Naming

`domain.event`, lowercase, underscore-separated: `klarna.push`,
`job.dead`, `ratelimit.store_unavailable`. Consistent prefixes are what make
`grep -E 'klarna\.'` a useful filter.

**Never log a secret, a card detail, a session token or a full address.** The
Sentry header allowlist exists for the same reason.

---

## Request tracing

There is no distributed tracer, and adding one is a deliberate non-decision
rather than an oversight — OpenTelemetry on Workers means a collector, a
sampling policy and a bill, for a system whose entire request path is one Worker
plus four HTTP dependencies.

What exists instead:

- **`cf-ray`** — Cloudflare's per-request id, present on every response and in
  every Cloudflare log. This is the correlation id.
- **`X-Error-Id`** — Sentry's event id, returned on a 500 so a support ticket
  becomes a one-click lookup.
- **`startSpan`** — records durations with an OpenTelemetry-shaped signature, so
  swapping in a real tracer needs no call-site changes.

For an incident, `cf-ray` ties the customer's report to the Cloudflare log to the
Worker log. That covers the overwhelming majority of what a tracer would.

---

## Health checks

### `/api/health` — liveness

Public, fast, `no-store`. Safe to hammer from an uptime monitor. Answers exactly
one question: is the Worker running.

### `/api/health/deep` — diagnostics

Requires `settings:read`. Enumerates subsystems, queue depth, integration
configuration and production readiness — useful to an operator and equally
useful to an attacker, hence the permission.

Reports **degraded** when something works but not as intended:

| Subsystem | Degraded when                                                 |
| --------- | ------------------------------------------------------------- |
| Database  | Unreachable                                                   |
| Cache     | Upstash configured but unreachable, or falling back to memory |
| Queue     | Oldest job waiting > 5 min, or any dead jobs                  |
| Search    | Index empty                                                   |

`readiness` mirrors `npm run verify:production` and is deliberately **not** part
of the degraded calculation: a staging environment is _supposed_ to be missing
production credentials, and marking it degraded for that trains people to ignore
the endpoint.

---

## External uptime

Health checks that run inside the thing being checked cannot report that the
thing is down. Configure an external monitor — Better Stack, Pingdom,
UptimeRobot, or Cloudflare's own Health Checks:

| Check              | Endpoint                        | Interval | Alert after |
| ------------------ | ------------------------------- | -------- | ----------- |
| Liveness           | `GET /api/health`               | 1 min    | 2 failures  |
| Home               | `GET /` contains a known string | 5 min    | 2 failures  |
| Certificate expiry | TLS on the apex                 | daily    | 14 days out |

From at least two regions. A single-region monitor reports a routing problem as
a full outage.

---

## Cloudflare Analytics

The dashboard answers what the application cannot see:

- **Cache hit rate** — under 80% for static assets means a cache rule is wrong
- **Bandwidth saved** — Brotli and cache effectiveness
- **Threats blocked** — WAF and bot management
- **Worker CPU time** — the p99 is what the bill tracks
- **Worker error rate** — 1101 (exception thrown), 1102 (CPU exceeded), 1015
  (rate limited)

A rising 1102 is the one to act on: it means a request is doing more work than
the CPU budget allows, and it fails as a hard error rather than as slowness.

---

## An incident, in order

1. **Is it up?** `/api/health` from outside.
2. **What is degraded?** `/api/health/deep`.
3. **What is erroring?** Sentry, filtered to the last hour.
4. **Which requests?** `wrangler tail --status error`.
5. **Is it us or upstream?** Cloudflare, Neon, Upstash, Klarna, Resend status
   pages.
6. **When did it start?** Sentry's release marker against the deploy history.
7. **Roll back?** `wrangler rollback --env production` — instant, and reverts the
   Worker only.

The checklist is in [troubleshooting.md](./troubleshooting.md).
