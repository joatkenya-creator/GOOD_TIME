# Klarna

The payment provider. Klarna is not a card gateway with a different logo, and
the difference shapes the whole order lifecycle.

---

## The model

At checkout the customer is **authorised**: Klarna underwrites them, guarantees
the merchant, and holds the amount against their credit line. **No money moves.**

Money moves when we **capture**, and Klarna's merchant terms require that to
happen at fulfilment. Capturing before shipping is a compliance problem, not a
cash-flow choice.

So there are two events where a card processor has one:

| Event             | What it means                                  | Code               | Effect                              |
| ----------------- | ---------------------------------------------- | ------------------ | ----------------------------------- |
| **Authorisation** | Customer is committed, Klarna carries the risk | `authorizePayment` | `Order.status → PAID`, receipt sent |
| **Capture**       | Money actually moves                           | `captureForOrder`  | `Payment.status: AUTHORIZED → PAID` |

`Order.status` answers "can we ship this". `Payment.status` answers "where is the
money". Conflating them is how a warehouse ships against an authorisation that
lapsed three weeks ago.

### Authorisations expire

Typically after 28 days. An item on backorder that ships on day 30 cannot be
captured and the revenue is simply gone. The `0 6 * * *` cron trigger runs
`extendExpiringAuthorizations()`, which extends anything within five days of
expiry. It is cheap insurance against a slow supplier quietly costing money.

---

## Getting credentials

1. Sign up at the [Klarna Merchant Portal](https://portal.klarna.com).
2. **Settings → Klarna API credentials → Generate new credentials.**
3. The username looks like `PK12345_1a2b3c4d`, **not** an email address.
4. The password is shown once. Store it immediately.

Playground and production are **separate accounts with separate credentials**.
They are not interchangeable, and a playground credential sent to the production
host authenticates and then 404s — a genuinely confusing way to lose an order.

```bash
KLARNA_USERNAME=PK12345_1a2b3c4d
KLARNA_PASSWORD=<generated>
KLARNA_REGION=na                    # na | eu | oc — must match the account
KLARNA_ENVIRONMENT=playground       # playground | production
NEXT_PUBLIC_KLARNA_ENVIRONMENT=playground
KLARNA_WEBHOOK_SECRET=<32+ random bytes, hex>
```

`KLARNA_REGION` is the one nobody expects. Klarna shards by the merchant
account's region; the wrong host authenticates fine and then cannot find the
resource.

---

## The checkout flow

```
 browser                          our server                     Klarna
    │                                  │                            │
    │  POST /api/checkout              │                            │
    ├─────────────────────────────────►│                            │
    │                                  │  placeOrder (reserve stock)│
    │                                  │  POST /payments/v1/sessions│
    │                                  ├───────────────────────────►│
    │       { clientToken, ... }       │◄───────────────────────────┤
    │◄─────────────────────────────────┤                            │
    │                                  │                            │
    │  Klarna.Payments.init(token)     │                            │
    │  Klarna.Payments.load(container) │        (iframe)            │
    │◄─────────────────────────────────┼───────────────────────────►│
    │  Klarna.Payments.authorize()     │                            │
    │  → authorization_token           │                            │
    │                                  │                            │
    │  authorizeCheckoutAction(token)  │                            │
    ├─────────────────────────────────►│                            │
    │                                  │  POST /authorizations/     │
    │                                  │       {token}/order        │
    │                                  ├───────────────────────────►│
    │                                  │◄─── order_id, fraud_status │
    │                                  │                            │
    │       redirect to /order/GT-x    │  Order → PAID, email sent  │
    │◄─────────────────────────────────┤                            │
```

**Step 4 happens on the server, never in the browser**, even though Klarna's API
would allow otherwise. Placing the order is the moment the customer becomes
liable; doing it server-side is what lets it be rate-limited, audited, retried
idempotently, and reconciled against the order we actually created.

### Fraud status

`placeOrder` returns one of three, and each takes a different path:

| `fraud_status` | Meaning                        | What happens                                                                    |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `ACCEPTED`     | Approved                       | Order → `PAID`, cart cleared, receipt sent                                      |
| `PENDING`      | Under review, minutes to hours | Order stays `PENDING`, stock stays reserved, nothing ships. Resolved by a push. |
| `REJECTED`     | Declined                       | `Payment → FAILED`. Order stays `PENDING` so the customer can retry.            |

A `redirect_url` alongside `PENDING` means the customer must finish in their
bank or the Klarna app. The order is real by then; they simply are not back yet.

---

## Push notifications

**Klarna does not sign its webhooks.** There is no `Stripe-Signature` equivalent.
The documented mechanism is an unguessable secret in the notification URL:

```
https://example.com/api/webhooks/klarna/{KLARNA_WEBHOOK_SECRET}
```

compared in constant time by `verifyPushToken`. Plain `===` on strings
short-circuits at the first differing byte, which leaks the secret one byte at a
time to anyone measuring response times.

That alone would be thin, so it is not the only control:

1. **The token** — checked in constant time. A miss returns 404, not 403, so
   probing does not confirm the path exists.
2. **The body is never trusted.** `syncFromKlarna` takes only the `order_id`,
   re-reads the order from Klarna's API over an authenticated connection, and
   applies _that_. Someone with the URL can make us perform a lookup. They
   cannot make us mark an order paid.
3. **A WAF rule** restricting the path to Klarna's published egress ranges —
   see [cloudflare.md](./cloudflare.md#custom-rules).

Configure the notification URL in the Merchant Portal under **Settings →
Merchant URLs**, and note that it is also sent per-session in `merchant_urls`,
which is what makes staging and production land in the right place.

---

## Reconciliation

`syncFromKlarna` is the single function every asynchronous path funnels through:
the push notification, the nightly job, and the admin's refresh button.

**Klarna's record always wins.** Ours is a cache of theirs, and a divergence is
either a notification we missed or a state we got wrong. That design is what
makes the whole system tolerant of a dropped webhook — the nightly reconcile
finds it, and a refund issued by hand in the Klarna portal is picked up without
anyone having told us.

---

## Refund and cancellation — not the same thing

| Situation                                 | Action                                   | Why                                                                                                                         |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Authorised, not captured, order cancelled | `cancelPayment`                          | Nothing moved, so nothing comes back. Leaving the authorisation alive holds the customer's credit line hostage for a month. |
| Captured, goods returned                  | `refundOrder`                            | Real money returned.                                                                                                        |
| Partially captured, rest cancelled        | `captureForOrder` then release remaining | Split shipment.                                                                                                             |

Klarna will not refund money that never moved. Calling `refundOrder` on an
uncaptured order throws a `CONFLICT` telling you to cancel instead.

Unlike a card gateway there is **no refund webhook**. Klarna's response _is_ the
confirmation, so the database is updated immediately; the nightly reconcile
catches anything done by hand in the portal.

---

## Idempotency

Klarna deduplicates writes carrying `Klarna-Idempotency-Key` for 24 hours. Every
key here is derived from our own data so it is stable across retries:

| Operation   | Key                                                |
| ----------- | -------------------------------------------------- |
| Place order | `order_{orderId}_authorize`                        |
| Capture     | `capture_{orderId}_{amountCents}`                  |
| Refund      | `refund_{orderId}_{amountCents}_{alreadyRefunded}` |

The refund key includes the already-refunded total on purpose: two deliberate
refunds of the same amount are two refunds, while a retry of one is still one.

The client's retry policy respects this. `GET` and `DELETE` retry freely; a
`POST` retries **only** if it carries an idempotency key. Session creation has
no key, so it never retries — a retry there would open a second Klarna session
for one order, and the customer's widget would be scored against a session we
then abandon.

---

## Order lines

Klarna renders these verbatim in its widget and in the customer's Klarna app.
This is not bookkeeping — it is what the buyer reads while deciding whether to
confirm, and it must match the order summary they just saw, to the cent.

Klarna refuses a session whose lines do not sum to `order_amount`. Per-item
percentage discounts round, so `buildOrderLines` reconciles against the stored
total and puts any residual on an explicit `Rounding adjustment` line. A delta
over five cents is logged as an error, because that one is a real bug.

Store credit and loyalty points appear as a **negative discount line**. They are
tender rather than a discount, but Klarna only ever authorises what it is
actually being asked to fund, and presenting the credit this way is what makes
the total in the widget equal the amount the customer will really be billed.

---

## Testing

### Playground

Klarna's playground has test personas per market. In the US flow, a date of
birth of `1970-01-01` and the OTP `123456` approves; other personas produce
declines and pending reviews. The current list lives in Klarna's own docs — it
changes, so it is not copied here.

### Automated

- `tests/klarna.test.ts` — the API client. Retries, error mapping, idempotency
  headers, constant-time token comparison. Uses a `fetch` stub at the
  _transport_ boundary, so the real request builder and error mapping are
  exercised and only the bytes on the wire are canned.
- `tests/payment-lines.test.ts` — order lines sum correctly under rounding.
- `scripts/verify-orders.ts` — the full lifecycle against a real database with a
  stubbed Klarna: authorise, replay, decline, cancel, refund.
- `e2e/checkout.spec.ts` — up to the widget mounting. Playwright cannot drive
  Klarna's cross-origin iframe, and a test that automates a third party's
  payment UI breaks whenever they ship a redesign.

The playground end-to-end flow is a **manual pre-launch check**. See
[go-live.md](./go-live.md).

---

## Going live

1. Klarna approves the merchant account (commercial process, takes days).
2. Generate **production** credentials — separate from playground.
3. `wrangler secret put KLARNA_USERNAME --env production` (and password).
4. Set `KLARNA_ENVIRONMENT=production` and
   `NEXT_PUBLIC_KLARNA_ENVIRONMENT=production` in `wrangler.jsonc`.
5. Generate a fresh `KLARNA_WEBHOOK_SECRET` — never reuse the playground one.
6. Set the notification URL in the Merchant Portal to production.
7. Add the Klarna egress WAF rule.
8. `npm run verify:production` — it checks `KLARNA_ENVIRONMENT` is `production`,
   precisely because pointing a live site at the playground is a silent failure.
9. Place one real order for a small amount and refund it.

---

## Common failures

| Symptom                                   | Cause                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 401 on every call                         | Username/password wrong, or playground credentials against production                            |
| 404 on every call                         | `KLARNA_REGION` does not match the account's region                                              |
| Widget renders, authorise fails           | CSP missing `*.klarna.com` in `connect-src` — see [`headers.ts`](../src/lib/security/headers.ts) |
| Widget never appears                      | Rocket Loader is on. Turn it off — it reorders scripts and breaks the SDK                        |
| `Order amount does not match order lines` | A discount rounded; check the `Rounding adjustment` line and the error log                       |
| Push notifications never arrive           | Notification URL not set in the portal, or the WAF rule is blocking Klarna                       |
| Capture fails with `NOT_ALLOWED`          | The authorisation expired. Check the nightly extension job is running                            |
