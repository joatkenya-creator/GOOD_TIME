# Admin

The administration system: what it manages, how authorisation works, and the
decisions that are not obvious from the code.

---

## Authorisation

Everything here rests on one rule, unchanged since phase 1: **code checks a
capability, never a role name.** A role is a bag of permissions; a screen asks
"can this person refund", never "is this person an administrator". That is what
makes a custom role created in the UI work everywhere immediately, with nothing
to deploy.

### Three layers

| Layer | Where                                             | What it catches                                                                                                                             |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge  | [`middleware.ts`](../src/middleware.ts)           | Unauthenticated requests, before any React runs. Fast, but reads a JWT — it cannot see a revoked session or a role changed a minute ago.    |
| Shell | [`admin/layout.tsx`](../src/app/admin/layout.tsx) | Anyone who is not staff at all. Guarding in the layout means a page added to the folder is protected before anyone remembers to protect it. |
| Page  | every `page.tsx` and every action                 | The specific capability that screen needs.                                                                                                  |

The third layer is the one that matters. A single gate at the door makes "can
you open the admin" and "can you refund four thousand dollars" the same
question, and they are not.

### Permissions

Thirty-eight capabilities in seven groups, in
[`constants/permissions.ts`](../src/constants/permissions.ts). Read, write and
delete are separated because the interesting mistakes live between them:

- `order:refund` is never bundled with `order:write` — one edits an address, the
  other moves money out of the business.
- `product:bulk` is separate from `product:write` — one click changes hundreds
  of rows, including prices.
- `inventory:adjust` is separate from `inventory:read` — a stock adjustment is
  the easiest place in an ecommerce system to hide theft.
- `customer:pii` gates addresses and phone numbers. Without it they render
  masked, so a marketing manager can segment without reading anyone's address.
- `role:manage` is separate from `role:assign` — handing out an existing role is
  an everyday task; editing what a role _means_ is the keys to the kingdom.

### Roles

Ten seeded roles, each with a demo account. Grants live in the database, so
editing one is a data change rather than a deploy; `ROLE_DEFINITIONS` only seeds
them.

Inheritance is composition, not a hierarchy. A tree ("manager inherits editor")
looks tidy until the first role that needs most of a parent but not one
dangerous piece of it — and then the tree grows an exception mechanism, or the
role quietly gets the permission anyway. Named bundles (`CATALOGUE_EDIT`,
`ORDER_DESK`, `CONTENT_DESK`) keep every grant explicit and greppable.

Two rules the code enforces rather than trusting:

- **The super administrator cannot be reduced.** Removing a permission from it
  is how an organisation locks itself out of its own store, and there is no
  second door.
- **The last super administrator cannot be demoted** — including by themselves,
  which is the usual way it happens.

### `withAdminAction`

Every mutation goes through one wrapper:

```ts
await withAdminAction(
  PERMISSIONS.productWrite,
  (actor) => updateProduct(id, input),
  (result) => ({ action: 'UPDATE', entityType: 'Product', entityId: result.id, changes }),
);
```

It checks the permission, runs the work, and writes the audit row — only if the
work succeeded. An action written this way _cannot_ be unpermissioned or
unlogged, because both are the wrapper's job rather than the author's
discipline. A server action is a public HTTP endpoint with friendly syntax; the
fact that only your own form posts to it is a UI detail, not a boundary.

---

## The audit trail

One row per mutation. Not compliance theatre — for the Monday morning when a
price is wrong, a customer was refunded twice, or four hundred products were
archived, and the only useful question is who did it and what it looked like
before.

Three rules the rest of the admin depends on:

1. **It never throws.** A failed audit write must not roll back the thing it was
   describing. A lost log line is bad; a lost order is worse.
2. **It stores the diff, not the record.** A full before/after snapshot of a
   product is mostly unchanged noise, and noise is what stops anyone reading it.
3. **It never stores secrets.** Passwords, tokens, gift-card codes and card data
   are stripped on the way in — an audit table is the one place nobody thinks to
   check for them, which makes it the worst place to keep them.

Exports are audited too, with the row count. An export is how customer data
leaves the building.

---

## Modules

| Module             | Notes                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**      | Every figure computed from live tables, each against the _previous equivalent window_ — "this month vs last month" on the 2nd is a lie everyone has learned to ignore. Growth from zero reports "no prior period", not ∞.        |
| **Products**       | Filters, sort and page live in the URL, so a filtered view is a link you can send. Bulk actions post row checkboxes to a server action, so the browser owns the selection and nothing can disagree with what is visibly ticked.  |
| **Product editor** | Tabs stay mounted (`hidden`, not unmounted) — unmounting drops every field edited on another tab, which is the worst possible failure for a form.                                                                                |
| **Inventory**      | The only path that changes a stock number is `adjustStock`, which writes the ledger row and the count in one transaction. There is deliberately no inline "just edit the number" anywhere else.                                  |
| **Media**          | A grid, not a table — the point of the screen is recognising an image. Alt text is edited inline because it is the field most likely to be missing and least likely to be fixed if it needs a second screen.                     |
| **Orders**         | State changes route through phase 4's `transitionOrder`, which already owns which transitions are legal, when stock releases and which emails fire. A second state machine here would be one that drifts.                        |
| **Customers**      | Lifetime value is aggregated in one query, not per row — fifty customers each triggering their own `SUM(orders)` is fifty round trips to render one screen.                                                                      |
| **Promotions**     | Coupons, gift cards and referrals on one screen: they are all "ways value leaves the business", and auditing that should not take four pages.                                                                                    |
| **Content**        | Announcements, banners, FAQs and footer links are one table with a `type`. They differ only in where they render; four near-identical tables would mean four near-identical screens.                                             |
| **Blog**           | The byline is a stored string, not a foreign key — a post keeps its author when the staff account that wrote it is closed, which is what a byline is for.                                                                        |
| **SEO**            | Per-record metadata is edited on the record's own editor, next to the name it defaults to. Only redirects and the sitemap have no other home. Redirect chains are refused at save.                                               |
| **Reports**        | Six reports, all live. Traffic says "not available" rather than drawing a plausible line — a fabricated conversion rate is the figure most likely to be acted on.                                                                |
| **Staff & roles**  | The permission editor. Grants are `set`, not diffed: the checkbox list is the complete intended state.                                                                                                                           |
| **Settings**       | Editable settings and environment secrets are visibly apart. Secrets show as connected/not and are never editable here — the settings table is readable by every process with a database connection and appears in every backup. |

---

## Decisions worth stating

**"Scheduled" is not a product status.** The enum has `DRAFT`, `ACTIVE`,
`ARCHIVED`; scheduled is `publishedAt` in the future. A fourth enum value would
need a job to flip it and a reconciliation for every row the job missed. Derived,
it simply becomes true when the clock passes.

**Deleting a sold product archives it instead.** Order items keep their own name,
SKU and price, so deleting does not corrupt history — but it breaks the link
from a customer's order back to what they bought, and from a refund to what is
being refunded. The caller is told what happened rather than left to assume.

**Duplicating always produces a draft**, with suffixed SKUs and zero stock.
Duplicating is how a new product starts; a copy that went live immediately would
put an unedited "Copy of…" on the shop.

**Tables are paginated, not virtualised.** Virtualisation solves ten thousand
rows in one DOM; pagination solves it by not putting them there, keeps the view
linkable, keeps Ctrl+F working, and needs no library. If a screen ever genuinely
needs ten thousand rows at once, that screen can have a windowed variant — none
of the eighteen here does.

**No chart library.** The dashboard sparkline is a polyline and an area fill;
the smallest charting dependency is far larger than the code it would replace.
Every chart also exposes its series as a visually hidden table, because a
`<path>` announces nothing to a screen reader.

**Exports need no dependencies.** CSV is four lines of quoting rules. "Excel" is
an HTML table served as `application/vnd.ms-excel`, which Excel has opened since
1997 — a real `.xlsx` needs a zip container and a schema to avoid one format
warning. PDF is a styled page and `window.print()`, because the browser already
has a PDF engine.

**Money exports as a decimal.** A spreadsheet showing `3900` where the merchant
expected `39.00` is a support ticket that arrives every single time.

**Packing slips carry no prices.** Warehouse staff need to know what goes in the
box; this category ships in plain packaging, and an itemised price list inside
the parcel undoes the point of the plain box.

**The dark theme is admin-only.** Inverting the ink ramp inside one scope flips
every component, because they all read the semantic aliases — that is what the
semantic layer was for. The storefront stays light: product photography is
colour-graded against white, and a shop that changes its own background because
a staff member toggled something elsewhere is a support ticket, not a feature.

**Theme and sidebar preferences are cookies, read on the server.** No inline
script in `<head>`, no flash, no `setState` in an effect on every page load.

---

## Test data

```bash
npm run db:seed:admin
```

Idempotent. Creates the ten roles, one demo account per role, content blocks,
navigation menus, settings, an opening stock ledger, redirects and customer
segments. All fictional; every address is `@example.test`, a reserved TLD that
can never receive mail, so a misconfigured mailer cannot reach a real person.

| Account                       | Role                |
| ----------------------------- | ------------------- |
| `owner.demo@example.test`     | Super administrator |
| `admin.demo@example.test`     | Administrator       |
| `manager.demo@example.test`   | Store manager       |
| `stock.demo@example.test`     | Inventory manager   |
| `orders.demo@example.test`    | Order manager       |
| `support.demo@example.test`   | Customer support    |
| `marketing.demo@example.test` | Marketing manager   |
| `editor.demo@example.test`    | Content editor      |
| `finance.demo@example.test`   | Finance manager     |
| `analyst.demo@example.test`   | Read-only analyst   |

Password for all of them: `GoodTimeAdmin2026!`

---

## Verification

```bash
npm run build && npx next start -p 3000
npm run db:seed:admin
npm run verify:admin
```

The checks that matter are not "does the page render" — the type checker covers
most of that — but **does the permission model actually hold**. Four roles are
signed in and pointed at surfaces they should and should not reach, because an
authorisation bug is invisible to every other kind of test: the page looks
perfect, it is simply showing it to the wrong person.

It also asserts that the sidebar hides what a role cannot open (a menu of doors
you cannot open is still a map of the building), that customer data renders
masked without `customer:pii`, that exports are audited, and that the dark theme
has no contrast failures.

---

## Not built, deliberately

Excluded by the brief: supplier and product import, large-scale synchronisation,
analytics pipelines, CI/CD and production monitoring.

Genuinely incomplete, and on record rather than implied:

- **Refunds are initiated at the payment provider** and reconciled here. The
  permission, the audit path and the value-return logic all exist — a refund
  already claws back loyalty and returns gift card value. What is missing is the
  provider call, which is deliberate: the payment provider is being reconsidered.
- **One warehouse.** Every adjustment records a location, so multi-warehouse
  allocation is a query change rather than a migration.
- **Media upload** registers assets and manages alt text; the direct-to-Cloudinary
  browser upload is wired to `registerMedia` but the signature endpoint needs the
  Cloudinary credentials to be present.

---

## Fulfilment

**No carrier API, and that is the only part missing.** Buying postage needs a
carrier account and a funding source, which is a production integration. What
exists is everything either side of that call: recording which carrier and
service went out, deriving the public tracking URL per carrier, printing a
label, and moving the order to `SHIPPED` so the customer is told.

`createShipment` is where a carrier call would go — it already takes the shape a
carrier returns and already writes `labelUrl`, so the integration replaces the
manual tracking number rather than the flow around it.

Two decisions worth stating:

**Fulfilling is one step, not two.** The form records the shipment _and_
transitions the order. A bare "mark shipped" button leaves a customer with an
order claiming to be in transit and a timeline that cannot say where — which is
the exact moment they contact support.

**The label is 4×6 and carries no branding.** That is thermal label stock, so it
prints correctly on a label printer as well as on paper; and the sender is the
neutral name, because a branded label undoes plain packaging at the sorting
office, on the doorstep, and in front of whoever collects the post.

---

## Gift cards

Redeemable at checkout, as tender.

**The code is a bearer instrument, so it is hashed.** Anyone holding it can
spend the balance, exactly like a password — only a SHA-256 of the normalised
code is stored, plus the last four characters so support can identify a card
someone is reading out. The code is shown once, at issue, and is not recoverable
afterwards by anyone including staff.

Normalisation matters more than it sounds: a customer who types lower case or
omits the dashes still gets their money.

**Every movement is a ledger row.** `balanceCents` is a cache; the truth is the
sum of `GiftCardTransaction`, and `reconcileGiftCard` proves they agree. A gift
card is a liability the business owes the bearer, and "why is this card empty?"
has to have an answer.

**It is tender, not a discount** — applied after tax, recorded in
`Order.giftCardAppliedCents`, never folded into `discountCents`. A discount
shrinks the taxable base; a gift card pays part of a bill already taxed in full.
Conflating them under-collects tax. Same reasoning as store credit.

**Loyalty is spent before gift cards.** Loyalty is the customer's own
accumulated value and it expires; a gift card does not. Spending the perishable
tender first costs the customer least, and it is not a choice they should have
to make at a checkout.

**The deduction is a conditional update inside the order transaction.** Two
checkouts racing for the last $20 cannot both win: the second matches zero rows
and the whole order rolls back, rather than shipping goods paid for with money
that was not there. `npm run verify:gift-cards` exercises exactly that race.

**A refund returns value to the card, not to the payment method.** The customer
never paid money for that portion, so refunding it as cash would hand them
something they did not spend. Idempotent, so a replayed refund returns it once.
