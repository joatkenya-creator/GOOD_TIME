# Quality

How the site is checked, what the checks found, and what is still broken on purpose.

---

## The sweep

```bash
npm run build && npx next start -p 3000
npm run verify:quality
```

Eighteen pages at three viewports, signed in, with axe-core run against the real
DOM on every one — 172 checks, roughly twelve minutes. It exists because the
three defect classes it catches are invisible to everything else in the toolchain:

| Check | Why a unit test cannot do it |
|---|---|
| **Responsive** — `scrollWidth` vs `clientWidth` at 375 / 768 / 1440 | A layout that works at 1440px says nothing about 375px. The failure reports the widest offending element, so the report is actionable rather than "something overflows". |
| **Accessibility** — axe-core, WCAG 2.1 AA, `serious` and `critical` only | Contrast, ARIA misuse and duplicate ids are properties of rendered pixels and computed styles. `minor` is excluded deliberately: it is full of advisory rules a design system trips constantly, and a check that always fails is a check nobody reads. |
| **Navigation** — every internal link followed, every sitemap URL fetched | Nothing in the app fails when a link rots. Nobody on the team clicks a sitemap. |
| **Network** — every response and console message, for the whole run | A 500 from a fetch nobody awaited still fails the run. |

The account area is swept signed in. Skipping it would skip the half of the site
that handles personal data.

### Current result

**175 passed, 0 failed.** 28 links to unbuilt content are reported separately as
a note — see below.

---

## What it found

Six defects, all shipped, none caught by TypeScript, ESLint or 154 unit tests.

### Contrast: three tokens below AA

| Token | Was | Ratio | Now | Ratio |
|---|---|---|---|---|
| `foreground-subtle` | `#999999` | 2.84:1 | `#707070` | 4.95:1 on white, 4.54:1 on `#F5F5F5` |
| `warning-700` | `#e65100` | 3.78:1 | `#c2410c` | 5.18:1 |
| `accent` (white text on it) | `#e91e63` | 4.34:1 | `#d81b60` | 4.95:1 |

57 violations across every page. `foreground-subtle` alone accounted for 46 on
the shop page — it was carrying timestamps, table headers, helper text and card
metadata. "Subtle" described how it looked to someone who could already read it.

The accent one is the instructive failure. `docs/design-system.md` had already
measured 4.34:1, decided it was acceptable because white-on-accent only appeared
"at the 18.66px+ semibold sizes used for large CTAs", and helpfully documented
the one-line fix for anyone wanting strict AA. The sweep found 16px
normal-weight submit buttons on that background in the cart, the newsletter form
and guest order lookup. The documented exception had become the common case, and
only a machine reading actual computed styles noticed.

### `aria-label` on a generic element

The animated trust counter carried its final value in `aria-label` on a bare
`<span>`, so screen readers would announce "50,000+" instead of narrating every
intermediate number. ARIA prohibits that attribute on an element with no role —
implementations are free to ignore it, which would have left the counter
announcing nothing at all. Now a visually hidden sibling, which is markup that
is allowed to say what it says.

### Sixteen product links to a route that never existed

Every product on the homepage linked to `/products/<slug>`. This app has never
served that path — products live under their category
(`/shop/vibrators/bullets/pebble-bullet-vibrator`). Ten of the sixteen products
were not in the catalog at all: the rails were hand-written arrays from phase 2,
written before there was a catalog to read, and never revisited once there was.

Both rails now read the catalog. `ProductCardData.href` changed from optional to
required, which is what makes it stay fixed — the optional field had a fallback
to `/products/<slug>`, so any caller that forgot to ask the catalog for a URL
silently produced a link to a 404. A bare slug cannot reconstruct the category
path, so there is no correct fallback to have. Making the field required turned
sixteen runtime 404s into sixteen compile errors.

### A sitemap advertising 404s

`/collections`, `/brands`, `/guides` and a URL per collection were published to
search engines. None of those routes exist. Submitting 404s costs crawl budget
and reads as a low-quality site.

### An account menu item Phase 5 never built

The header dropdown linked to `/account/settings`. Phase 5 built `profile`,
`security` and `notifications` instead.

### A loading boundary that duplicated the page shell

`app/loading.tsx` flushed the streamed shell early, so a `notFound()` raised
afterwards left the empty original in the DOM beside the 404 — two
`<main id="main">`, two footers, a broken skip link. It also made a missing
category answer **200 instead of 404**, telling crawlers the page exists.
Deleting the file fixed both.

---

## Known gaps — phase 6

**28 links point at content routes that were never built.** They are reported by
`verify:quality` as a separate count rather than as failures, because a check
that fails on every run stops being read, and because counting them as passes
would let the twenty-ninth dead link ship unnoticed. A new dead link outside
these prefixes still fails the sweep.

| Prefix | Count | Linked from |
|---|---|---|
| `/pages/*` | 12 | Footer, homepage |
| `/collections`, `/collections/*` | 10 | Homepage collections section |
| `/guides`, `/guides/*` | 4 | Homepage journal section |

Full inventory:

```
/collections                    /guides                              /pages/accessibility
/collections/better-together    /guides/choosing-your-first-vibrator  /pages/care
/collections/first-toy          /guides/cleaning-and-storing-toys     /pages/contact
/collections/gift-edit          /guides/silicone-glass-or-steel       /pages/cookies
/collections/glass                                                    /pages/discreet-packaging
/collections/kink-curious                                             /pages/gift-cards
/collections/non-porous                                               /pages/help
/collections/quiet-hours                                              /pages/lubricant-guide
/collections/silicone                                                 /pages/materials
/collections/steel                                                    /pages/returns
                                                                      /pages/shipping
                                                                      /pages/warranty
```

### Terms and Privacy — closed early, and why

These two were originally in the list above. They came out of it because the
register form makes customers tick "I agree to the Terms" and "Privacy Policy",
and both links returned a 404 — so customers were agreeing to documents that did
not exist before handing over an address and a card. That is not content
backlog, it is a consent problem.

They now live in
[`features/legal/documents.ts`](../src/features/legal/documents.ts) as typed
content, rendered by `/pages/[slug]`. In code rather than a CMS because a CMS is
phase 6 and these were needed now.

**They are drafts and have not been reviewed by a lawyer.** That review has to
happen before launch: an adult-products retailer in the US has age-verification,
state-privacy and card-network obligations that vary by state and change.

What makes them worth reviewing rather than replacing is that they describe what
the system actually does, checked against the code:

| Claim | Where it is true |
|---|---|
| "Your card number never reaches our servers" | `payment.service.ts` — Stripe Payment Intents, token references only |
| "Every device signed in, and you can sign any of them out" | `security.service.ts`, `/account/security` |
| "Failed sign-ins are recorded" | `LoginEvent`, shown on the security page |
| "Delete your account yourself" | `profile.service.ts` — `deleteAccount()` |
| "Addresses stored as a snapshot per order" | `Order.shippingAddressSnapshot` |
| "We cannot tell you your password" | Argon2 hashes, `server/auth/password.ts` |

Where a policy sentence depends on implementation, the code that makes it true
is named in a comment beside it. A privacy policy that has drifted from the data
model is worse than none, because it is a written statement that is false.

`/pages/[slug]` sets `dynamicParams = false` and generates only the two slugs
that exist, so the other twelve `/pages/*` links keep returning a real 404. A
"coming soon" page where a returns policy should be looks like an answer.

When a prefix starts resolving, remove it from `UNBUILT_PREFIXES` in
`scripts/verify-quality.mjs` so the sweep starts guarding it.

---

## The rest of the suite

```bash
npx tsc --noEmit             # 0 errors
npm run lint                 # 0 errors
npx vitest run               # 154 unit tests
npm run verify:quality       # 175 checks — responsive, a11y, navigation, network
npm run verify:phase5        # 49 checks — the account area, in a browser
npm run verify:account       # 43 checks — account pages, landmarks, forms
npm run verify:orders        # 41 checks — order service against the database
npm run verify:flow          # 39 checks — cart and checkout, end to end
npm run verify:rewards       # 26 checks — loyalty ledger against the database
npm run verify:confirmation  # 22 checks — confirmation page and receipt
```

`verify:confirmation` takes an order number and email; `verify:orders` prints
both as its last lines.

Every browser harness accepts `BASE_URL`, and defaults differ by script — pass it
explicitly rather than trusting the default to match the port you started.
