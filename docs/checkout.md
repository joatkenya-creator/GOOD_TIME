# Cart, checkout, payments and orders

Phase 4. How money moves through this system, and which parts you must replace
before charging a real customer.

---

## The one rule

**The client never sends a price.**

Every total is recomputed on the server from the cart and the catalogue, on every
read and again at the moment of charge. A request body carrying `unitPriceCents`
would be a discount the customer writes for themselves, and no amount of
client-side validation changes that.

The corollary matters just as much: **the webhook is the only thing that marks an
order paid.** The browser returning to a success page proves nothing — it can be
forged, replayed, or simply never arrive because someone closed the tab on a
train.

---

## Money

Integers, always. Cents for money, basis points for tax rates, grams for weight.
No floats touch a price anywhere in this codebase, and `0.1 + 0.2` is why.

| Concept  | Unit          | Example         |
| -------- | ------------- | --------------- |
| Money    | integer cents | `1999` = $19.99 |
| Tax rate | basis points  | `825` = 8.25%   |
| Weight   | grams         | `1500` = 1.5 kg |

Klarna also works in cents for USD, so there is no conversion at the boundary and
nowhere for a factor-of-100 bug to hide.

### Order of operations

Fixed, and encoded in [`totals.ts`](../src/features/checkout/totals.ts):

```
subtotal   = Σ (unit price × quantity)
discount   = coupon applied to subtotal, capped at subtotal
shipping   = rate priced against the discounted basket
tax        = per jurisdiction, on (subtotal − discount) [+ shipping if taxed]
total      = subtotal − discount + shipping + tax
```

Three decisions inside that are worth stating:

- **Discount before tax.** Tax is charged on what the customer actually pays, not
  on the pre-discount subtotal.
- **Each jurisdiction rounds separately.** State 6.25% + county 2.00% on $19.99 is
  125¢ + 40¢ = **165¢**. Summing the rates first and rounding once gives 164¢.
  One cent, every order, in the wrong direction on an audit.
- **`FREE_SHIPPING` zeroes shipping without reducing the taxable base.** A waived
  shipping charge is not a discount on goods.

`roundCents` rounds half _away from zero_, because `Math.round(-0.5)` is `-0` and
that quietly loses a cent on every refund.

### The database enforces it too

```sql
CHECK (totalCents = subtotalCents - discountCents + shippingCents + taxCents)
CHECK (discountCents <= subtotalCents)
```

If `computeTotals` and the constraint ever disagree, the insert fails rather than
writing an order nobody can reconcile. `npm run smoke:checkout` proves the two
agree against real rows.

---

## Cart

[`cart.service.ts`](../src/services/cart.service.ts)

One cart per visitor, keyed by session user id or by the `gt.cart` cookie for
guests. The cookie is `httpOnly` — nothing client-side has a reason to read a
cart id — and `Secure` is gated on `NEXT_PUBLIC_SITE_URL` starting with `https://`
rather than on `NODE_ENV`, so a production build served over http locally still
works. (WebKit silently refuses to store a `Secure` cookie over http; Chromium
makes an exception for localhost, which is exactly how this class of bug survives
to production.)

**Prices are re-read from the variant on every cart render.** `CartItem.unitPriceCents`
is a historical snapshot, not the charging price. A cart left open for a week
shows today's price.

**Merging.** `mergeGuestCart` runs from the Auth.js `signIn` event, so it happens
on every path in — credentials, OAuth, anything added later. Quantities are
**summed**, not replaced: someone who added an item on their phone and again on
their laptop meant to have two.

**Coupons are re-validated on every read**, never trusted from `cart.couponId`. A
basket that drops below a code's minimum silently loses the discount, which is the
only way to stop someone applying a code and then removing items.

---

## Coupons

[`coupon.service.ts`](../src/services/coupon.service.ts)

Rejection reasons: `NOT_FOUND`, `INACTIVE`, `NOT_STARTED`, `EXPIRED`,
`USAGE_LIMIT_REACHED`, `USER_LIMIT_REACHED`, `MINIMUM_NOT_MET`, `WRONG_CUSTOMER`,
`FIRST_ORDER_ONLY`.

`WRONG_CUSTOMER` deliberately returns the **same message** as `NOT_FOUND`.
Confirming that a code exists but belongs to someone else turns the coupon table
into an enumeration oracle.

A per-user limit on a code redeemed by a guest is rejected outright — the limit is
unenforceable without an account, and allowing it lets one person redeem a
single-use code forever by not signing in.

`recordRedemption` takes a transaction client and **must** run inside the order
transaction. Incrementing separately means a failed order still burns a
single-use code.

---

## Shipping

[`shipping.service.ts`](../src/services/shipping.service.ts)

Rates are rows, not code, so operations can add "Free over $75" without a deploy.

| Type           | Price                                                              |
| -------------- | ------------------------------------------------------------------ |
| `FLAT`         | `baseCents`                                                        |
| `FREE`         | `0`                                                                |
| `WEIGHT_BASED` | `baseCents + ceil((weight − freeWeightGrams) / 1000) × perKgCents` |

Per _started_ kilogram, which is how carriers actually bill. `freeAboveSubtotalCents`
is applied **last**, so an order that qualified for free delivery cannot still be
charged a weight surcharge.

`states` is an allow-list: empty means everywhere we ship, populated restricts.
A state-restricted rate is hidden when no destination is known yet — better to
withhold an option than to quote a price we cannot honour.

Delivery estimates count business days only. Carrier holidays are not modelled;
that arrives with the carrier integration, which knows its own calendar.

**Replacing this with a carrier API** means reimplementing `priceFor` and
`getShippingOptions`. Nothing above them changes.

---

## Tax

[`tax.service.ts`](../src/services/tax.service.ts) - [`tax/taxjar.ts`](../src/services/tax/taxjar.ts)

`quoteTax` is the only entry point. It picks an implementation; nothing upstream
knows which one answered.

### Two implementations

**TaxJar** - active when `TAX_PROVIDER=taxjar` and both `TAXJAR_API_KEY` and a
ship-from address are set. A single stateless `POST /v2/taxes` returns a full
jurisdiction breakdown. It knows the ~11,000 real jurisdictions, which of them tax
shipping, and - the part a rate table cannot express even in principle - **whether
you have nexus at all**. `has_nexus: false` is an authoritative "charge nothing",
not a gap in our data.

**The seeded table** - the default. Combined state-level averages: close enough to
show a plausible number in a cart, nowhere near close enough to file a return on.

TaxJar over Avalara for a store this size: AvaTax wants a company code, a document
type and a commit/void lifecycle that only earns its keep once you are filing in
dozens of states. An Avalara adapter would implement the same
`quote(input) => TaxQuote` contract and nothing above it would change.

### Amounts, not rates

A rate table lets us _derive_ amounts. A provider hands back **amounts**, and its
figure is what gets remitted - so `computeTotals` takes a `taxLines` input that it
uses verbatim rather than re-deriving. Re-deriving would only manufacture a
discrepancy between the receipt and the filing.

This is why `placeOrder` calls `computeTotals` twice: once with no tax to learn the
discounted base, then again with the quote folded in. Both passes are pure integer
math, and the arithmetic - including the `orders_total_is_sum` identity - keeps
exactly one implementation.

TaxJar rounds each component and the total independently, so the parts can miss the
whole by a cent. The adapter reconciles by pushing the remainder onto the largest
component: the total is what gets charged, and a receipt that does not add up is a
support ticket.

### Where each is used

|                         | Implementation | Why                                                                                                    |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Cart / checkout summary | table          | Labelled "estimated". TaxJar bills per call and a cart render is not a sale                            |
| `placeOrder`            | `quoteTax`     | Money is about to move                                                                                 |
| Payment step            | -              | Displays the order's authoritative total, so nobody types a card number without seeing the real figure |

### When the provider fails

The table stands in and the quote is marked `degraded`. This is fail-**open**, and
it is deliberate: a tax provider having a bad afternoon should not stop the store
taking orders.

That trade is only defensible because the affected orders are findable afterwards.
`Order.taxSource` records `provider`, `table`, `none`, or `table-degraded` - the
last meaning a provider was configured, failed, and the estimate was charged
instead:

```sql
SELECT "orderNumber", "taxCents", "createdAt"
FROM orders WHERE "taxSource" = 'table-degraded';
```

The call has a hard 2.5s timeout. Checkout blocks on it, and 2.5s is already longer
than anyone waits politely.

## Orders

[`order.service.ts`](../src/services/order.service.ts)

### Numbers

`GT-100042`, from a Postgres sequence starting at 100000. Sequential and quotable
down a phone line. It leaks order volume, which is an accepted trade — and it is
why the number alone never grants access to an order (see below).

### Status

```
PENDING ──► PAID ──► CONFIRMED ──► PROCESSING ──► SHIPPED ──► DELIVERED
   │         │           │              │             │           │
   └─► CANCELLED ◄───────┴──────────────┘             └► RETURNED ─┴─► REFUNDED
```

Transitions not in the table are rejected, not silently applied. `transitionOrder`
writes the `OrderEvent` in the same transaction — an untimelined status change is
the thing support cannot explain three weeks later.

### Inventory

| Moment           | `quantity` | `reserved` |
| ---------------- | ---------- | ---------- |
| Order placed     | —          | `+ qty`    |
| Payment succeeds | `− qty`    | `− qty`    |
| Order cancelled  | —          | `− qty`    |

**Reserved on order, decremented on payment.** Decrementing an unpaid order lets
anyone empty the warehouse by starting checkouts they never finish.

### Reservation expiry

`releaseExpiredReservations` cancels `PENDING` orders older than 60 minutes and
returns their stock. Scheduled every 15 minutes via
[`vercel.json`](../vercel.json) -> `/api/cron/release-reservations`.

This is the job that makes reserve-on-order safe. Without it, every abandoned
checkout holds stock that is neither sold nor sellable, and a popular variant
eventually reads "out of stock" because of people who closed a tab.

Three details that matter:

- **The window is 60 minutes, not the 15 of `TOKEN_TTL.cartReservation`.**
  Cancelling an order out from under someone mid-3DS on a slow bank app is far
  worse than holding one unit for another hour, and 3DS challenges genuinely take
  minutes.
- **`paidAt: null` is in the query.** The webhook sets `paidAt` before the status,
  so this closes the race where a payment succeeds between the scan and the
  cancellation.
- **Each order is cancelled independently, and failures are counted, not thrown.**
  One row losing a race to a webhook must not strand the rest of the batch -
  `canTransition` rejecting a now-`PAID` order is the correct outcome, not an
  error.

The endpoint requires `Authorization: Bearer $CRON_SECRET`. An unset secret denies
every request: a scheduled job anyone can trigger is a denial of service with extra
steps.

### Access

`getOrderByNumber(orderNumber, email)` requires both. Order numbers are
enumerable by design, so the number is not a secret and the email is what
authorises. A signed-in customer's history is scoped to `session.userId`, never to
a query parameter.

---

## Payments

[`payment.service.ts`](../src/services/payment.service.ts)

Payment Intents, not Checkout Sessions: the card form stays on our domain inside a
Klarna-hosted iframe, so the checkout keeps its own layout and
analytics while card numbers never reach our JavaScript, servers or logs. That is
what keeps this store in PCI **SAQ-A**.

### Idempotency, three layers

1. `Klarna-Idempotency-Key: order_<id>_authorize` on the Klarna call — a double-submitted form
   returns the same intent instead of charging twice.
2. `Payment.idempotencyKey` is `@unique` in the database.
3. `transitionOrder` is a no-op when the order is already in the target status, so
   a replayed push changes nothing. Klarna retries for hours; assume every
   event arrives twice.

### Events handled

| Event                           | Effect                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `payment_intent.succeeded`      | → `PAID`, commit inventory, clear cart, send confirmation                    |
| `payment_intent.payment_failed` | Record the decline. Order **stays** `PENDING` so the customer can retry      |
| `payment_intent.canceled`       | → `CANCELLED`, release stock and the coupon redemption                       |
| `charge.refunded`               | → `REFUNDED` / `PARTIALLY_REFUNDED`, email the customer                      |
| `charge.dispute.created`        | Internal note only — a customer who just charged back does not need an email |

Anything else is acknowledged with 2xx. Returning an error makes Klarna retry an
event we were never going to act on.

A handler that **throws** returns 500 and Klarna _does_ retry, which is correct for
a transient database failure.

### Refunds

`refundOrder` calls Klarna and updates the database from the response. Unlike a
card gateway there is no refund webhook to wait for — Klarna's reply _is_ the
confirmation. The nightly reconcile re-reads the order anyway, which is what
catches a refund issued by hand in the Klarna portal. Previously this was the
`charge.refunded` webhook that follows. Writing both here would leave the two out
of step whenever the provider accepted the refund and this process then died.

### Amount mismatch

If `amount_received` does not match `order.totalCents`, the payment is still
accepted — the customer authorised that amount — and the discrepancy is logged at
error level for a human. Rejecting money a customer has already paid is the worse
failure.

---

## Discretion

This store sells adult products. Discretion is a product requirement, not a
nicety, and it shows up in four places:

- **Statement descriptor** — `statement_descriptor_suffix: 'GT ORDER'`. Never a
  product name on a shared bank statement.
- **Email subjects** — "Order GT-100042 confirmed", never what is in the box.
  Preheader text is set explicitly so the inbox preview is safe on a lock screen.
- **Packaging** — plain and unbranded, stated on the PDP, in the cart, at checkout
  and in every email, because the reassurance is worth more before the purchase
  than after.
- **Age confirmation** — an unticked checkbox on the review step, in addition to
  the site-wide age gate. Pre-ticking a legal attestation makes it worthless.

---

## Email

[`email.service.ts`](../src/services/email.service.ts)

Hand-written HTML. Email clients are stuck in 2005, so the markup is tables and
inline styles either way, and a template literal produces exactly that without
another dependency.

`sendOrderConfirmation`, `sendShippingNotification`, `sendDeliveryConfirmation`,
`sendCancellationEmail`, `sendRefundEmail`, `sendNewsletterConfirmation`.

Sends are **awaited**, not fired and forgotten — a serverless function that returns
before its promises settle gets frozen mid-send. A failure only logs: the money is
already taken and the webhook must still return 2xx.

Every send writes an `EMAIL_SENT` order event. "Did you send it?" is the
second-most-common support question after "where is my order".

Newsletter signup is **double opt-in**. A ticked box on a checkout form is a weaker
consent record than a click from the inbox, and consent is exactly the thing that
gets asked about in a CAN-SPAM complaint.

---

## Checkout UI

Four steps — Contact, Shipping, Payment, Review — as **client state, not routes**.
A route per step means the browser back button leaves checkout entirely from step
one, and it means four round trips through a flow where every extra second costs
orders.

One React Hook Form spans all four. Every step stays mounted and is hidden with
`hidden`, so going back never remounts an input and loses a value. `useWatch`
rather than `watch()`, or the React Compiler bails out of optimising the whole
component.

`/checkout` lives in its own route group with **no header, mega menu or footer**.
Every navigation link on that page is a route out of a funnel someone is already
in.

`autoComplete` tokens are scoped (`section-shipping given-name`), which is the
difference between a 40-second checkout and a 4-second one on a phone.

---

## Verification

```bash
npm run db:seed:checkout   # shipping rates, tax rates, demo coupons — idempotent
npx vitest run             # 115 unit tests, 53 of them on money
npm run smoke:checkout     # 28 database-level checks, incl. reservation expiry
npm run verify:orders      # order lifecycle driven by Klarna reconciliation
npm run verify:flow        # 39 checks: cart + checkout in a real browser
npm run verify:confirmation GT-100013 someone@example.test   # 22 checks
npm run audit:checkout     # responsive + a11y, Chromium and WebKit, 4 viewports
```

`verify:orders` prints the order number and email its last two lines — feed those
to `verify:confirmation`.

`smoke:checkout` creates a real order, asserts the database constraint accepts it,
walks the inventory through reserve → commit, proves the sequence is unique, drives
a backdated order through the expiry sweep (and proves a recent one survives it),
and deletes everything it made.

`audit:checkout` seeds a cart through the API first — an empty cart renders an
empty state and `/checkout` redirects away from it, so nothing about the real
layout is observable until something is in the bag. Serve it on the port
`NEXT_PUBLIC_SITE_URL` names, or Auth.js issues a cross-origin callback URL and
CSP blocks the session fetch.

`verify:orders` drives `syncFromKlarna` against a stubbed Klarna transport, so the
real request builder, error mapping and every database write are exercised. It uses the shapes Klarna actually
posts. Test cards need API keys; the webhook they eventually cause does not, and
the webhook is the only thing this system treats as authoritative — so the real
path is covered without a network.

### Two rules the browser harnesses encode

Both were learned by getting them wrong, and both cost an hour of chasing bugs
that did not exist:

1. **Never retry a mutating click.** Wrapping "click, then check" in a retry loop
   with a wrong selector clicked _increase quantity_ fourteen times and reported
   the resulting $1,246 subtotal as a pricing bug. Wait for hydration once with a
   read-only probe, then act.
2. **Poll for the expected state, not for a duration.** These actions take
   seconds against a remote database, and the re-render streams in _after_ the
   POST resolves. A fixed `waitForTimeout` turns latency into a phantom failure.

---

## Before going live

1. **Switch tax to a provider.** Set `TAX_PROVIDER=taxjar`, `TAXJAR_API_KEY` and
   the four `SHIP_FROM_*` variables, then register for collection in every state
   where you have nexus - TaxJar returns zero for states you have not registered
   in, which is correct only if that is actually true. This is the item that
   carries legal risk. Verify with a test order to a known address before opening.
2. **Set `STRIPE_WEBHOOK_SECRET`** from the live endpoint, not the CLI's test
   secret.
3. **Point `NEXT_PUBLIC_SITE_URL` at https.** HSTS, `upgrade-insecure-requests`
   and the cart cookie's `Secure` flag all key off it.
4. **Verify the statement descriptor** in the Klarna Merchant Portal actually reads as
   discreet.
5. **Set the real `EMAIL_FROM` sender name** — it appears in the inbox next to
   every subject line.
6. **Set `CRON_SECRET`** and confirm the schedule appears under Vercel ->
   Settings -> Cron Jobs after the first deploy. Without the secret the endpoint
   returns 503 and reservations are never released.

---

## What verification caught

Six defects, none of which class inspection or unit tests would have surfaced:

| Defect                                                | Why it mattered                                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guest orders stored no shipping address**           | The address priced tax and shipping, then was discarded — a guest order recorded nowhere to ship it. Fixed with `shippingAddressSnapshot` on the order.              |
| **A corrected field swallowed the next click**        | Blur cleared the error, the message unmounted, the Continue button moved up 28px, and the mouseup missed. Reachable via autofill. Fixed by reserving the error slot. |
| **A replayed webhook re-sent the confirmation**       | Klarna retries a push for hours. Stock and status were idempotent; the email and timeline entry were not. Fixed with a `paidAt` guard.                               |
| **Undo raced the removal it undid**                   | The undo toast fired an add while the delete was still in flight; whichever landed second won. Fixed by chaining undo off the removal's promise.                     |
| **Two controls shared one accessible name**           | At quantity 1 the minus button was also labelled "Remove <product>" — indistinguishable from the real remove, and only one offered an undo. Minus now stops at 1.    |
| **`revalidatePath('/', 'layout')` on every cart tap** | Dropped the router cache for the whole site; add-to-cart took 12s and the badge still lagged. Now client state via `use-cart-count`, and add-to-cart is ~3.5s.       |

## Known gaps

- **Tax is quoted once, at order creation.** Someone who abandons at the card form
  and returns much later pays the rate quoted then, not now. Rates change rarely
  enough that re-quoting on every payment retry is not worth the API call.
- **Shipping is priced without a destination on the checkout's first render.**
  State-restricted rates are filtered only once the address is known. `placeOrder`
  re-prices against the real address, and that price is what is charged.
- **No partial fulfilment.** `Shipment` exists and the schema supports multiple per
  order, but nothing splits an order across them yet.
- **Guest addresses are not persisted.** A row against no account is one nobody can
  ever access or delete.
- **The fallback table is state-level only.** The schema supports county and ZIP
  rows; the seed does not populate them. This only matters while
  `TAX_PROVIDER=table` or during a provider outage.
- **No address validation.** ZIP format is checked, but nothing confirms the ZIP
  belongs to the city and state. A plausible-but-wrong address gets a
  plausible-but-wrong tax quote. TaxJar has an address-validation endpoint if this
  becomes a problem.
- **A failed PaymentIntent leaves a PENDING order.** `placeOrder` and
  `createPaymentIntent` cannot share a transaction — one is a database write, the
  other a network call. If Klarna is unreachable the order exists with no session.
  The reservation sweep cancels it within the hour.
- **Cart writes take ~3.5s against a remote database.** Three sequential round
  trips from a development machine to Neon. Same-region on Vercel this is far
  less, but the shape is worth watching: `addToCart` is the hottest write here.
- **Soft 404s.** `notFound()` in a route that reads `searchParams` still returns
  200 in Next 16. Order pages withhold their contents correctly — verified — and
  are marked `noindex`, but the status code is wrong.
