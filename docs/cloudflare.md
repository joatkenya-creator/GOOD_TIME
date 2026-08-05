# Cloudflare configuration

Everything the edge does before a request reaches the Worker — and most of the
performance and security posture lives here rather than in application code.

The rule of thumb: **anything Cloudflare can answer, the Worker should never
see.** A cached product page costs nothing; a redirect served from a Bulk
Redirect costs nothing; a bot blocked by the WAF costs nothing. Every request
that wakes the Worker is billed CPU-ms and adds latency.

---

## DNS

| Type            | Name                | Content                                                | Proxy        |
| --------------- | ------------------- | ------------------------------------------------------ | ------------ |
| A/AAAA or CNAME | `example.com`       | managed by Wrangler (custom domain)                    | Proxied      |
| CNAME           | `www`               | managed by Wrangler (custom domain)                    | Proxied      |
| TXT             | `example.com`       | `v=spf1 include:_spf.resend.com ~all`                  | —            |
| CNAME           | `resend._domainkey` | from the Resend dashboard                              | **DNS only** |
| TXT             | `_dmarc`            | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com` | —            |
| TXT             | `example.com`       | Google Search Console verification                     | —            |

Both custom domains are declared in `wrangler.jsonc` and provisioned by
`wrangler deploy`. Do not create them by hand as well — two records for one
hostname is a deploy that fails with a confusing conflict.

**The DKIM record must be DNS-only.** Proxying it hides the value behind
Cloudflare's IPs, DKIM verification fails, and every email lands in spam. This
is the single most common email-deliverability mistake.

### www → apex

A **Bulk Redirect**, not application code:

```
Source:      https://www.example.com/*
Target:      https://example.com/${1}
Status:      301
Preserve:    query string ✓,  path ✓
```

Served from the edge without waking the Worker. Doing it in `middleware.ts` costs a
Worker invocation on every misdirected request, forever.

---

## SSL/TLS

| Setting                             | Value                                       | Why                                                                                                                              |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Encryption mode                     | **Full (strict)**                           | Anything less lets someone between Cloudflare and the origin read traffic. "Flexible" is plaintext to the origin — never use it. |
| Minimum TLS version                 | **1.2**                                     | 1.0 and 1.1 are deprecated and fail PCI review.                                                                                  |
| Opportunistic Encryption            | On                                          |                                                                                                                                  |
| TLS 1.3                             | On                                          | 0-RTT resumption, one fewer round trip                                                                                           |
| Automatic HTTPS Rewrites            | On                                          | Fixes `http://` references in third-party embeds                                                                                 |
| Always Use HTTPS                    | On                                          |                                                                                                                                  |
| HSTS                                | On, 2 years, includeSubDomains, **preload** | Also sent by the app in [`headers.ts`](../src/lib/security/headers.ts).                                                          |
| Certificate Transparency Monitoring | On                                          | Tells you when a certificate is issued for your domain that you did not request                                                  |

**HSTS preload is a one-way door.** Once the domain is on the browser preload
list, removing it takes months. Confirm every subdomain can serve HTTPS before
enabling it.

---

## Cache rules

Ordered; the first match wins. Cloudflare evaluates these before the Worker.

### 1. Never cache — the correctness rule, first

```
When:  (starts_with(http.request.uri.path, "/api/"))
    or (starts_with(http.request.uri.path, "/admin"))
    or (starts_with(http.request.uri.path, "/account"))
    or (starts_with(http.request.uri.path, "/checkout"))
    or (starts_with(http.request.uri.path, "/cart"))
    or (starts_with(http.request.uri.path, "/order/"))
Then:  Bypass cache
```

This rule exists to prevent one specific catastrophe: caching a personalised
page and serving one customer's order to another. It is first because a rule
below it can never undo the damage.

### 2. Immutable build assets

```
When:  starts_with(http.request.uri.path, "/_next/static/")
Then:  Eligible for cache
       Edge TTL:    1 year
       Browser TTL: 1 year
```

Content-hashed filenames. A changed file is a changed URL, so a year is safe and
anything shorter is wasted revalidation.

### 3. Images

```
When:  http.request.uri.path matches "\.(jpg|jpeg|png|webp|avif|svg|ico)$"
    or starts_with(http.request.uri.path, "/_next/image")
Then:  Eligible for cache
       Edge TTL:    30 days
       Browser TTL: 7 days
       Cache key:   include query string (width and quality vary the output)
```

Browser TTL is shorter than edge TTL on purpose: a purge clears the edge
instantly, and cannot clear a browser cache at all.

### 4. Product and category pages

```
When:  starts_with(http.request.uri.path, "/shop")
Then:  Eligible for cache
       Edge TTL:    5 minutes
       Browser TTL: 0  (respect origin)
       Cache key:   include query string
```

Five minutes is deliberately short. A price or a stock level that is thirty
minutes stale is a customer adding something to a basket they cannot buy.
Next's own ISR, backed by R2, is what actually keeps this fast — the edge cache
is the second layer, not the first.

**Browser TTL 0 matters.** A browser-cached product page cannot be purged. A
customer would see yesterday's price until they hard-refreshed.

### 5. Home page

```
When:  http.request.uri.path eq "/"
Then:  Eligible for cache
       Edge TTL:    2 minutes
       Browser TTL: 0
```

The most-hit page and the one carrying merchandising that changes by the hour.

### 6. Everything else

```
Then:  Respect origin headers
```

Next's own `Cache-Control` is correct for the remainder. Overriding it here
would break streaming and route-level revalidation.

### Purging

`revalidateTag` and `revalidatePath` invalidate the Next cache in R2/KV, not
Cloudflare's edge cache. Those are separate layers. To purge the edge:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"files":["https://example.com/shop/lumen-silk-chemise"]}'
```

Never `{"purge_everything": true}` on a live site. It cold-starts every page at
once and the resulting stampede hits the database far harder than the stale
content ever hurt.

---

## WAF and firewall rules

In order. **Test every rule in Log mode before enabling Block.** A rule that
blocks legitimate checkout traffic is worse than the attack it stops.

### Managed rulesets

| Ruleset                             | Mode                                     |
| ----------------------------------- | ---------------------------------------- |
| Cloudflare Managed Ruleset          | On                                       |
| OWASP Core Ruleset                  | On, paranoia level 1, score threshold 40 |
| Cloudflare Leaked Credentials Check | On                                       |

Paranoia 2+ on OWASP produces false positives on ordinary product descriptions
for this catalogue. Level 1 with the managed ruleset is the practical setting.

### Custom rules

**Protect the admin**

```
(starts_with(http.request.uri.path, "/admin") and ip.src ne <office IP>)
→ Managed Challenge
```

Not Block — an admin travelling would lock themselves out permanently. A
Managed Challenge is passable by a human and expensive for a script.

**Rate-limit authentication**

```
Rule:      Rate limiting
When:      http.request.uri.path in {"/sign-in" "/register" "/forgot-password"}
           and http.request.method eq "POST"
Rate:      10 requests per 1 minute per IP
Action:    Block for 10 minutes
```

Duplicated in the application ([`auth.actions.ts`](../src/actions/auth.actions.ts))
on purpose. This one is free and stops the traffic before it costs anything; the
application's is the one that survives someone bypassing the edge.

**Restrict the Klarna webhook**

```
(starts_with(http.request.uri.path, "/api/webhooks/klarna") and
 not ip.src in $klarna_egress)
→ Block
```

Klarna does not sign its pushes — the secret in the URL is the primary control
(see [klarna.md](./klarna.md#push-notifications)). This is the second one. Build
`$klarna_egress` as an IP List from Klarna's published ranges and keep it under
review; if it drifts, remove the rule rather than leaving a stale one to drop
real notifications.

**Block obvious probes**

```
(http.request.uri.path contains "/wp-admin" or
 http.request.uri.path contains "/.env" or
 http.request.uri.path contains "/.git" or
 http.request.uri.path contains "phpmyadmin")
→ Block
```

None of these exist here. Blocking at the edge keeps them out of the logs and
out of the Worker's bill.

**Geographic scope**

```
(ip.src.country ne "US" and starts_with(http.request.uri.path, "/checkout"))
→ Managed Challenge
```

Only if the shop ships to one country. Adjust or drop it otherwise — this is a
rule that silently costs sales if the shipping policy changes and nobody updates
it.

---

## Bot management

| Setting              | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Bot Fight Mode       | On (or Super Bot Fight Mode on a paid plan)            |
| Verified bots        | Allow — Googlebot and Bingbot must reach the catalogue |
| Definitely automated | Managed Challenge                                      |
| Likely automated     | Log, then Challenge once the traffic is understood     |

**Never block verified bots.** Blocking Googlebot deindexes the shop, and the
recovery takes weeks.

Turnstile handles what bot management cannot: the slow, scripted abuse that
looks human. It is applied to registration, password reset, newsletter signup
and guest order lookup — see
[`turnstile.ts`](../src/lib/security/turnstile.ts) — and deliberately **not** to
checkout. A customer with a full basket who gets a challenge is a lost sale, and
Klarna already scores that request far more thoroughly than a bot check could.

---

## Speed

| Setting                     | Value               | Note                                                                            |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| Brotli                      | On                  | The Worker sets `compress: false` so this is the only compression pass          |
| HTTP/3 (QUIC)               | On                  |                                                                                 |
| 0-RTT Connection Resumption | On                  |                                                                                 |
| Early Hints                 | On                  | Real LCP improvement on product pages                                           |
| Polish                      | Lossy + WebP        | Only for images not already served by Cloudinary                                |
| Mirage                      | On                  | Mobile connections                                                              |
| Rocket Loader               | **Off**             | Reorders script execution and breaks Klarna's SDK and React hydration           |
| Auto Minify                 | **Off**             | Deprecated, and the build already minifies. Double-minifying breaks source maps |
| Tiered Cache                | On (Smart Topology) | Fewer origin fetches from distant regions                                       |

Rocket Loader being off is not optional. It defers and reorders scripts in a way
that breaks Klarna's widget mounting, and the symptom is an intermittent blank
payment step that is nearly impossible to reproduce.

---

## Queues

Declared in [`wrangler.jsonc`](../wrangler.jsonc); created once per the
[deployment guide](./deployment.md#3-create-the-queues). Operational detail is
in [queues.md](./queues.md).

Watch, in the dashboard under Workers → Queues:

- **Backlog** — should be near zero. Sustained growth means the consumer is
  failing or too slow.
- **DLQ depth** — should be exactly zero. Anything here is a message whose
  _delivery_ failed repeatedly, which is an infrastructure problem, distinct
  from a job whose _work_ failed (that becomes `JobStatus.DEAD` in Postgres and
  appears in `/admin/jobs`).

---

## Web Analytics

Cloudflare Web Analytics is cookieless and first-party, so it is the one
measurement tool that needs no consent banner. Enable it in the dashboard, then
add it in the admin under **Marketing → Integrations** as
`CLOUDFLARE_WEB_ANALYTICS` with `requiresConsent: false` — the same DB-driven
tag system as every other provider, so it is togglable without a deploy.

---

## Observability

`observability.enabled` is on in `wrangler.jsonc` with head sampling at 1.0. At
this traffic level sampling saves money on logs nobody reads, and the whole
point is that the one broken checkout is in there.

```bash
wrangler tail --env production --format pretty
wrangler tail --env production --status error
```

---

## API token scopes

For CI (`CLOUDFLARE_API_TOKEN`), least privilege:

- Account → Workers Scripts → **Edit**
- Account → Workers R2 Storage → **Edit**
- Account → Workers KV Storage → **Edit**
- Account → Queues → **Edit**
- Zone → Workers Routes → **Edit**
- Zone → Cache Purge → **Purge** (only if CI purges)

Not a Global API Key. That key can delete the account.
