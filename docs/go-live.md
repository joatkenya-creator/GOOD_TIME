# Go-live checklist

Work top to bottom. Anything unchecked is a decision to launch without it, which
is a legitimate choice — but it should be a choice somebody made rather than
something nobody noticed.

Items marked **BLOCKER** should not be waived.

---

## Infrastructure

```
[ ] Cloudflare account, Workers plan sufficient for expected traffic
[ ] R2 buckets created:   intimate-bunnie-cache, intimate-bunnie-cache-staging
[ ] KV namespaces created, and their ids pasted into wrangler.jsonc
[ ] Queues created, DLQs first:
    intimate-bunnie-jobs-dlq, intimate-bunnie-email-dlq,
    intimate-bunnie-jobs, intimate-bunnie-email
[ ] Durable Object migration applied (wrangler deploy does this)
[ ] Staging deployed and reachable
[ ] Production deployed and reachable
[ ] Cron triggers firing — Cloudflare → Workers → Triggers shows recent runs
[ ] wrangler secret list matches docs/environment.md for both environments
```

**BLOCKER: staging and production must not share a database, a queue, an
Upstash instance or a Klarna account.** A staging deploy must be structurally
incapable of charging a real customer.

## DNS

```
[ ] Apex and www resolve, both proxied through Cloudflare
[ ] www → apex Bulk Redirect, 301, path and query preserved
[ ] SPF record present, exactly one, includes _spf.resend.com
[ ] DKIM CNAME present and DNS-only (NOT proxied)          ← BLOCKER
[ ] DMARC record present, p=quarantine or stricter
[ ] Google Search Console verification TXT present
[ ] No stale A records from a previous host
[ ] Registrar auto-renew on, expiry more than 60 days out
```

The DKIM record being proxied is the single most common launch failure. It puts
every transactional email in spam, including password resets.

## SSL

```
[ ] Encryption mode: Full (strict), not Flexible               ← BLOCKER
[ ] Minimum TLS 1.2
[ ] Always Use HTTPS on
[ ] HSTS enabled, 2 years, includeSubDomains
[ ] curl -sI https://example.com | grep -i strict-transport
[ ] Certificate valid on apex and www
[ ] SSL Labs grade A or better
```

HSTS **preload** is a one-way door — months to undo. Confirm every subdomain can
serve HTTPS before enabling it.

## Database

```
[ ] Neon production branch created
[ ] Autosuspend DISABLED on production                          ← BLOCKER
[ ] Min compute ≥ 1 CU
[ ] History retention ≥ 7 days
[ ] DATABASE_URL uses the -pooler host                          ← BLOCKER
[ ] DIRECT_DATABASE_URL uses the direct host
[ ] npx prisma migrate status → up to date
[ ] npm run db:seed (reference data) applied once
[ ] npm run db:seed:phase7 (schedules, import templates) applied once
[ ] NO demo catalogue, customers or admin seeded into production
[ ] Weekly pg_dump job configured and its first run verified
[ ] A restore has actually been tested (docs/disaster-recovery.md)
```

## Payments

```
[ ] Klarna merchant account approved for production
[ ] Production credentials generated (separate from playground)
[ ] KLARNA_ENVIRONMENT=production and NEXT_PUBLIC_KLARNA_ENVIRONMENT=production
[ ] KLARNA_REGION matches the account's region
[ ] Fresh KLARNA_WEBHOOK_SECRET — never the playground one   ← BLOCKER
[ ] Notification URL set in the Merchant Portal to production
[ ] Klarna egress WAF rule added
[ ] One real order placed end to end, for a small amount      ← BLOCKER
[ ] That order captured via the admin fulfilment flow
[ ] That order refunded, and the refund confirmed in the portal
[ ] Order appears correctly in the Klarna Merchant Portal
[ ] Statement descriptor is discreet
```

The end-to-end order is not optional. Everything up to it can be correct while
one wrong region or a stale secret makes checkout fail for every customer.

## Email

```
[ ] Domain verified in Resend, all three records passing
[ ] EMAIL_FROM = "INTIMATE BUNNIE <yowens@yoassoc.com>"
[ ] EMAIL_REPLY_TO set, and NOT the sending address
[ ] Test send to Gmail: SPF PASS, DKIM PASS, DMARC PASS       ← BLOCKER
[ ] Test send to Outlook and Apple Mail — layout intact
[ ] Order confirmation renders with real order data
[ ] Password reset arrives within a minute, and works
[ ] Resend webhook configured and signature verifying
[ ] Bounce suppression tested against an invalid address
[ ] Newsletter double opt-in works end to end
[ ] List-Unsubscribe headers present on marketing mail
[ ] Subject lines discreet — check one on a phone lock screen
```

## Analytics

```
[ ] GA4 configured in the admin, receiving events in real time
[ ] GTM container published (not just saved)
[ ] Google Ads conversion firing on a real purchase
[ ] Meta, TikTok, Pinterest pixels configured
[ ] Microsoft Clarity recording
[ ] Cloudflare Web Analytics enabled
[ ] Consent banner appears for a first-time visitor
[ ] NO advertising tag loads before consent — verify in the network tab  ← BLOCKER
[ ] Rejecting consent keeps them unloaded across a navigation
[ ] Ecommerce events fire: view_item, add_to_cart, begin_checkout, purchase
[ ] Purchase event value matches the order total
```

Tags loading before consent is a GDPR violation and — for a shop like this one —
a betrayal of a specific expectation a customer brings.

## SEO

```
[ ] robots.txt: correct sitemap URL, /checkout /account /admin disallowed
[ ] /sitemap-index.xml valid, lists children, children list real URLs
[ ] Every indexable page: unique title, description, absolute canonical
[ ] Filtered and sorted listings canonicalise to the unfiltered page
[ ] /checkout, /account, /cart carry noindex                   ← BLOCKER
[ ] Open Graph complete, image resolves, 1200×630
[ ] twitter:card = summary_large_image
[ ] Product JSON-LD validates in the Rich Results Test, with an offer
[ ] BreadcrumbList present
[ ] Organization and WebSite on the home page
[ ] A missing product returns a real 404, not a soft one
[ ] Redirects from any previous site are in place
[ ] npm run verify:links passes — no broken links, no duplicate metadata
[ ] Search Console property verified, sitemap submitted
```

## Performance

```
[ ] npm run lighthouse passes every budget
[ ]   Performance     ≥ 90
[ ]   Accessibility   ≥ 95
[ ]   Best Practices  ≥ 95
[ ]   SEO             ≥ 95
[ ] LCP < 2.5s on the home page and a product page, mobile
[ ] CLS < 0.1
[ ] Cache rules applied and verified via cf-cache-status
[ ] Brotli on, HTTP/3 on, Early Hints on
[ ] Rocket Loader OFF                                           ← BLOCKER
[ ] Auto Minify OFF
[ ] Images serving AVIF/WebP — check the response content-type
[ ] Tested on a real mid-range phone on real mobile data
```

Rocket Loader breaks the Klarna widget intermittently. It must be off.

## Security

```
[ ] npm run verify:production passes                            ← BLOCKER
[ ] Security headers present: CSP, HSTS, X-Frame-Options, Referrer-Policy,
    Permissions-Policy, X-Content-Type-Options
[ ] CSP allows Klarna — checkout tested with the CSP live
[ ] No unsafe-eval in the production CSP
[ ] WAF managed rulesets on
[ ] Rate-limiting rules on /sign-in, /register, /forgot-password
[ ] Admin paths behind a Managed Challenge
[ ] Bot Fight Mode on, verified bots allowed                    ← Googlebot!
[ ] Turnstile on registration, password reset, newsletter, order lookup
[ ] Klarna webhook rejects a wrong token (returns 404)
[ ] Resend webhook rejects a bad signature
[ ] Cross-origin POST to /api/checkout returns 403
[ ] Client-supplied prices ignored — verified by the E2E spec
[ ] Admin API returns 401/403 as JSON, never an HTML redirect
[ ] A signed-in customer cannot reach admin endpoints
[ ] No secrets in git history — the CI scan passes
[ ] All secrets recorded in the password manager
[ ] AUTH_SECRET is unique to production and at least 32 characters
[ ] Cloudflare API token scoped, not a Global API Key
[ ] npm audit --audit-level=high clean
```

## Accessibility

```
[ ] npm run test:e2e passes the accessibility spec
[ ] Zero serious or critical axe violations on every key page
[ ] Skip link is the first focusable element
[ ] Focus visible everywhere
[ ] Mobile menu traps focus, Escape closes it, focus returns
[ ] Exactly one h1 per page
[ ] Every image has an alt attribute
[ ] Forms: labels, error messages associated, errors announced
[ ] Checkout completable by keyboard alone                      ← BLOCKER
[ ] Tested with VoiceOver or NVDA on the checkout flow
[ ] Contrast ≥ 4.5:1 for body text
[ ] Respects prefers-reduced-motion
```

## Monitoring

```
[ ] SENTRY_DSN set, and a deliberate test error appears in Sentry  ← BLOCKER
[ ] NEXT_PUBLIC_SENTRY_DSN set to a separate browser project
[ ] SENTRY_RELEASE set by CI, source maps uploaded
[ ] Alert rules configured (docs/monitoring.md)
[ ] Alerts route somewhere a human reads out of hours
[ ] External uptime monitor on /api/health, two regions
[ ] Certificate expiry alert, 14 days out
[ ] /api/health/deep reports everything healthy
[ ] wrangler tail shows structured JSON, not [object Object]
[ ] Cloudflare Workers Logs retaining
```

An alert nobody receives is a dashboard.

## Backups

```
[ ] Neon history retention ≥ 7 days
[ ] Pre-deploy branch snapshot verified in the deploy log
[ ] Weekly pg_dump running, encrypted, off-site
[ ] Cloudinary auto-backup ENABLED                              ← BLOCKER
[ ] A restore has been performed and timed
[ ] docs/disaster-recovery.md contacts filled in
[ ] Somebody other than the author knows where this document is
```

Cloudinary auto-backup is off by default. Losing that account otherwise loses
every product image permanently.

---

## Launch day

```
[ ] Freeze deploys except for fixes
[ ] Everyone who might be needed is contactable
[ ] Point DNS at Cloudflare
[ ] Verify the site resolves from several networks and a mobile connection
[ ] Place one real order, all the way through
[ ] Confirm: order in the admin, in Klarna, receipt received, GA4 purchase fired
[ ] Watch Sentry and wrangler tail for the first hour
[ ] Check Cloudflare Analytics for unexpected traffic patterns
```

## First 24 hours

```
[ ] Sentry: any new issue triaged
[ ] /api/health/deep: nothing degraded
[ ] Queue: oldestQueuedSeconds low, dead jobs zero
[ ] Every order paid and reconciled against Klarna
[ ] Every confirmation email delivered — check the Resend dashboard
[ ] No unexpected 4xx or 5xx in Cloudflare Analytics
[ ] Cache hit rate as expected
[ ] Search Console: no new coverage errors
```

Then move to the routine in [maintenance.md](./maintenance.md).
