# The customer account

Phase 5. Everything behind `/account`: what a customer can see and change, what is
architecture waiting for a later phase, and which decisions are deliberate.

---

## The one rule

**Identity comes from the session, never from the caller.**

No service function and no server action accepts a user id. Every one starts with
`requireUser()` and scopes its query to that id. The difference between "update my
profile" and "update anyone's profile" is a single parameter, and the only way to
never get it wrong is to never accept one.

The same applies to reads. `/account/orders/GT-100042` looks the order up by
`{ orderNumber, userId }` — not by order number with an ownership check afterwards,
because the check is what gets forgotten.

---

## Layout and protection

`(storefront)/account/layout.tsx` is the gate. It calls `requireUser('/account')`
and sets `robots: { index: false, follow: false, nocache: true, noimageindex: true }`
for everything beneath it.

Guarding in the layout rather than per page means **a page added to this folder is
protected by default**. The alternative is protected by memory, and memory is where
the unguarded page comes from.

`export const dynamic = 'force-dynamic'` for the same reason: this is personal
data, and a cached account page served to the wrong person is the worst bug in the
system.

---

## Pages

| Route | What it does |
|---|---|
| `/account` | Dashboard: orders, wishlist, rewards, addresses, recommendations |
| `/account/profile` | Name, phone, email, password, regional settings, account closure |
| `/account/addresses` | Address book with defaults per type |
| `/account/orders` | History, filterable by status |
| `/account/orders/[orderNumber]` | Detail, reorder, return request, invoice |
| `/account/returns` | Return requests and their status |
| `/account/wishlist` | Saved items, move to bag, share link |
| `/account/recently-viewed` | Browsing history, individually removable |
| `/account/notifications` | Per-topic, per-channel preferences |
| `/account/security` | Password, devices, sign-in history, 2FA status |
| `/account/rewards` | Points, credit, tier, referral code |
| `/account/payment-methods` | Saved cards (references only) |
| `/wishlist/[token]` | A shared wishlist — public, `noindex`, no owner details |

---

## Sessions

Authentication is a JWT (`authConfig.session.strategy`). `UserSession` rows do not
authenticate anyone — they exist so a customer can **see** where they are signed in
and revoke it, which a stateless token cannot express on its own.

The JWT carries the row's id, and **every request verifies the row is still live**,
so revoking a device takes effect on its very next request.

That check lives in `getSessionUser`, and where it lives is the whole point. It was
originally in the Auth.js `jwt` callback, which looks like the natural home and is
the wrong one: a JWT is self-contained, so Auth.js decodes the cookie on an ordinary
read and re-runs `jwt` only on sign-in, on `update()`, or when the token is
re-issued. The check therefore fired exactly once per session — at sign-in, against
a session created microseconds earlier. It passed every time and protected nothing.

Instrumenting the callback and requesting a protected page produced one log line,
for `trigger: "signIn"`, and none for the page. Nothing in the type system or the
unit tests could have said so.

`getSessionUser` is the single funnel every protected page, route handler and server
action passes through, and it is wrapped in React's `cache()`, so the lookup happens
at most once per request however many callers ask.

The redirect that follows arrives client-side rather than as a 307. The account
shell streams, so by the time the guard rejects, the response headers are long gone
and Next has to tell the router instead. No account data is rendered either way, but
it is worth knowing before reading a test that waits for the URL to change.

The lag was not the first design either. The original checked once a minute, to
avoid "a database read per request". Measuring it settled the argument:

```
bare round trip        226.6 ms   <- network, Kenya -> us-east-2
liveness lookup        226.6 ms
marginal query cost      0.02 ms  <- the actual cost of the check

Index Scan using user_sessions_pkey  (actual time=0.017..0.019 rows=1)
```

The check is a primary-key lookup costing **0.019ms** of database work and no
extra round trip on any page that already queries anything. The lag was protecting
against a cost that did not exist, while leaving a stolen laptop working for a
minute after its owner hit "sign out everywhere". Correctness wins a trade that
cheap.

The *write* is still throttled — `SESSION_TOUCH_INTERVAL_SECONDS`. "Last active 40
seconds ago" and "just now" are the same answer to a customer, and one write per
request is a real cost where one read is not.

One consequence is not obvious. `requireUser` always attaches a `callbackUrl`, even
when the caller names no return path, because the edge proxy sees only the JWT and
still believes a revoked session is valid. Redirect a revoked visitor to `/sign-in`
without that parameter and the proxy bounces them straight back to the page that
just rejected them, forever. The parameter is how a server-side guard tells the edge
that the database has already said no.

Changing a password revokes every other device automatically. A password is changed
either because it was weak or because it was exposed; in the second case, leaving
other sessions alive defeats the point.

### Sign-in history

Every attempt is recorded, successful or not — `LoginEvent`, with outcome, IP and
user agent. The failures are the ones that matter: three bad passwords from a
country the customer has never visited is the signal, and it only exists if the
failures were written down. Nothing acts on them automatically yet, because a
badly-chosen lockout threshold locks out real customers while barely inconveniencing
a botnet.

### Two-factor

Architecture only, and the columns are **deliberately absent** rather than
present-and-unused. A nullable `twoFactorSecret` that gates nothing invites a later
reader to assume it is populated and trust it.

When it lands: TOTP, not SMS. Text messages are interceptable by taking over a phone
number, which is not a theoretical risk for everybody who shops here.
`LoginOutcome.FAILED_2FA` already exists so the history can tell a wrong password
from a wrong code.

---

## Notifications

One row per customer per topic, channels as columns. **A missing row means "the
default for that topic", never "off".** That distinction is the whole design: an
account created before a topic existed must keep receiving its order confirmations,
and it would not if absence meant silence.

Transactional topics default on, marketing defaults off. "Unsubscribe from
everything" turns off every non-essential topic in one click — CAN-SPAM effectively
requires that — while order, shipping and security mail survives it. Someone who
unsubscribes from marketing still needs to be told their order shipped.

SMS and push are rendered but disabled. Showing them greyed out sets the
expectation that they are coming; hiding them means nobody knows to ask.

---

## Returns

A return is its own aggregate, not a flag on an order: it has its own lifecycle, its
own timeline and its own subset of line items. An order can be partly returned
twice, for different reasons, weeks apart, and a boolean cannot express that.

```
REQUESTED ──► APPROVED ──► IN_TRANSIT ──► RECEIVED ──► REFUNDED
    │            │                            │
    ├─► REJECTED │                            └─► REJECTED
    └─► CANCELLED└─► CANCELLED
```

**What is live:** customers can file a request. It is validated, numbered from a
Postgres sequence (`RMA-100042`), stored, and visible to them.

**What is architecture:** approval, inspection and refund. The statuses and
transitions exist; the admin UI that drives them arrives with the dashboard.
`refundOrder` in the payment service is what an approval will call, and it already
works.

The validation worth noting: a request is checked against quantities already claimed
on *other* returns, not just against the order. That is the check a naive
implementation misses and a determined customer finds.

---

## Rewards

Two layers. The **rules** live in
[`features/account/rewards-rules.ts`](../src/features/account/rewards-rules.ts) as
pure functions over integers — no database, no `Date.now()`, every function that
needs "now" takes it as an argument. That is what makes them exhaustively testable,
and money rules that cannot be tested are money rules nobody can safely change.

The **ledger** lives in the service, with the invariant that makes it trustworthy:
every balance change is a row, and the balance is the sum of the rows. Nothing
writes a balance directly.

### The programme

| | |
|---|---|
| Earning | 1 point per $1 of goods, times the tier multiplier |
| Point value | 1 cent — so the base programme returns 1% |
| Redemption floor | 500 points ($5) |
| Expiry | 24 months from the day earned; store credit never expires |
| Tiers | Trailing-12-month spend: Silver $250, Gold $750, Platinum $2,000 |
| Multipliers | 1× / 1.25× / 1.5× / 2× |
| Birthday | 500 points, once per calendar year |
| Referral | $10 credit once the referred friend's first order clears $30 |

Every one of those numbers is a pricing decision with real margin attached. They
live in one file, with tests that catch what changing them breaks. The rewards page
imports them rather than restating them, so the page cannot drift from what the
code actually pays.

### Decisions worth stating

**Goods only.** Shipping and tax do not earn. Neither is margin a reward can come
out of, and rewarding tax would mean a customer in a high-tax state earns more for
the same basket.

**Discounts do not earn.** A coupon already gave that value away once.

**The order that triggers a promotion earns at the old rate.** `awardForOrder`
reads the tier, pays at it, and only then recalculates. Earning at the new rate
would mean the order causing a promotion is also the first to benefit from it —
which nobody expects and which is impossible to explain.

**Tiers are trailing, not lifetime.** A tier should describe who someone is now.

**Credit and points are tender, not a discount.** They are applied *after* tax and
recorded in `Order.creditAppliedCents`, never folded into `discountCents`. A
discount reduces the taxable base; credit pays part of a bill that was already
taxed in full. Conflating them under-collects tax. `totalCents` therefore stays the
full amount owed and keeps satisfying `orders_total_is_sum`; the card is charged
`totalCents - creditAppliedCents`.

**A bill fully covered by credit never reaches Stripe.** Stripe rejects a
zero-amount intent, correctly — there is no payment to make. The order transitions
to `PAID` directly, running the same path a webhook would.

**Redemption is deducted inside the order's transaction**, for the same reason a
coupon redemption is: two checkouts started at once must not both spend the same
balance. Non-negative check constraints are the backstop.

**A refund does both halves.** It claws back what the order earned *and* returns
what it spent. Keeping the points pays a reward for a sale that did not happen;
keeping the redemption charges the customer twice. The clawback may drive a balance
to zero but never below — a negative balance is a debt nobody agreed to.

**Expiry writes a negative row** rather than editing the row that earned the
points. The history has to keep saying "you earned 300 here" alongside "300 expired
there", or a customer watching a balance shrink has no way to see why.

`reconcile()` proves the cached balance equals the ledger, for the day someone asks
"is this number right?" — so the answer is a query rather than an opinion.

---

## Wishlist

Two stores, one list. A guest's lives in `localStorage` so it works without an
account; a signed-in customer's lives in the database so it survives a new laptop.

- The client keeps writing to `localStorage` either way, so toggling a heart stays
  instant and the server copy catches up.
- `WishlistSync` merges the two at sign-in, once per browser session. **Union, never
  replace** — someone who saved three things signed out and two signed in expects
  five.
- Sharing mints an unguessable token, not the wishlist id. Revoking is setting it
  back to null, which is why sharing is a toggle rather than a one-way door.

The shared page shows **no name and no contact details**. This store sells adult
products; a share link gets forwarded, and what it reveals should stop at "these are
things someone likes". It is `noindex` for the same reason.

---

## Recommendations

Every function returns `ProductCardView[]` and takes a customer plus a context. That
signature is the contract an eventual recommendation service has to satisfy — nothing
above the file knows how a list was produced.

Heuristics, not machine learning: viewed-not-bought, then categories you buy from,
then what sells. They are cheap, explainable to a customer who asks why they are
seeing something, and need no training data — which a store that has not launched
does not have. A model trained on an empty order table recommends noise with more
confidence than a rule does.

`frequentlyBoughtTogether` is a real co-purchase query over order history and
returns nothing until there is history to learn from. An empty rail is honest; a
fabricated one is not.

---

## Account closure

Soft delete, deliberately. Orders survive: they are financial records with tax
implications, and a hard delete would either destroy them or orphan them.

What goes: the ability to sign in, plus everything that exists only to serve a live
customer — cart, wishlist, browsing history, saved cards, addresses, sessions. The
email is replaced with `deleted+<id>@deleted.invalid` so the address can be reused
and stops resolving to a person.

The confirmation requires typing `DELETE` **and** the password. A checkbox is muscle
memory; a password is what a browser fills in for you. Typing is the only one of the
three that means "I understand this is irreversible".

---

## Saved cards

**No card data is stored and none may ever be.** A row is a Stripe PaymentMethod
reference plus the display fragments Stripe itself returns — enough for "Visa ending
4242". Storing a card number, even encrypted, moves this store out of PCI SAQ-A into
a scope requiring an annual audit. That is a business decision, not an engineering
one.

Saving a card at checkout needs Stripe SetupIntents, which are not wired up. The
schema and the page are ready for them.

---

## Verification

```bash
npm run db:seed:customers   # three fictional accounts, idempotent
npx vitest run              # 154 unit tests, 31 of them on the loyalty rules
npm run verify:account      # 43 checks in a real browser
npm run verify:rewards      # 26 checks against the live database
```

`verify:rewards` proves the parts that only exist once rows do: that earning is
idempotent under a replayed webhook, that a promotion does not retroactively
re-rate the order that caused it, that a refund claws back and hands back, that
expiry cannot drive a balance negative, and that the ledger and the cached balance
never disagree.

`verify:account` signs in as a seeded customer and walks every page: the auth guard,
the `noindex` directives, that on-screen data matches the database, that no order but
your own is reachable, plus horizontal overflow at three breakpoints, accessible
names on every control, and one `h1` and one `main` per page.

Serve it on the port `NEXT_PUBLIC_SITE_URL` names. On any other port Auth.js issues
an absolute redirect to the configured origin and the harness follows it to a dead
port.

---

## What verification caught

Six defects, none of which the type checker or unit tests would have found:

| Defect | Why it mattered |
|---|---|
| **Session revocation never ran on a page request** | The liveness check sat in the Auth.js `jwt` callback, which does not run when a JWT session is merely read. "Sign out everywhere" left every other device fully signed in until its token expired. The API was protected; the account pages were not. |
| **The guard and the edge proxy redirected at each other** | Once the guard worked, a revoked device bounced between `/account` and `/sign-in` until the browser gave up, because the proxy reads the JWT and cannot see a revocation. Fixed by always sending a `callbackUrl`. |
| **The root loading boundary duplicated the entire storefront shell** | A `notFound()` raised after the shell had streamed left the empty original in the DOM beside the 404 — two `<main id="main">`, two footers, a broken skip link. It also made missing categories answer **200 instead of 404**, which tells a crawler the page exists. Deleting `app/loading.tsx` fixed both. |
| **The default loading skeleton rendered its own `<main>`** | Every route transition inside the storefront briefly had two `main` landmarks and two `id="main"`, breaking the skip link. Pre-existing since phase 1; found by adding a landmark probe. |
| **The CSRF origin check never accepted the request's own host** | `new URL(request.url).origin` looks like it does, but Next normalises `request.url` to the deployment URL — so the allow-list collapsed to one entry and a preview deployment would 403 every write. Now reads the forwarded host, with tests. |
| **The 404 page nested a `<main>` inside the layout's** | Same landmark problem, on the page people reach when something has already gone wrong. |

---

## Known gaps

- **A partial refund does not adjust loyalty.** Only a full one does. Which lines
  came back is a judgement call, and guessing at the split would be worse than
  waiting for the admin dashboard to say.
- **Nothing attributes a referral at sign-up yet.** `RewardAccount.referredByCode`
  is read and paid out correctly; no registration field writes it.
- **Two-factor is not implemented**, only planned — see above for why the columns are
  absent rather than dormant.
- **SMS and push are not deliverable.** The preference rows exist and the switches are
  disabled.
- **Saving a card is not possible yet.** Needs Stripe SetupIntents.
- **Email change does not send a verification link.** The address is marked unverified
  immediately, which is the security-relevant half; the send needs `RESEND_API_KEY`.
- **No address autocomplete or validation beyond format.** A plausible-but-wrong
  address passes. The same gap the checkout has.
- **Recommendations do not personalise across customers.** Collaborative filtering
  needs traffic this store has not seen.
- **Soft 404s.** `notFound()` in a route reading params still returns 200 in Next 16.
  Content is correctly withheld — verified — but the status code is wrong.
