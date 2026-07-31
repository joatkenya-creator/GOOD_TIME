# Catalogue

How product discovery works: the data model, the query strategy, and the
decisions that keep it fast at 100,000 products.

Component index: [components.md](components.md) · Schema:
[`prisma/schema.prisma`](../prisma/schema.prisma)

---

## Routes

| URL                                 | Renders                      |
| ----------------------------------- | ---------------------------- |
| `/shop`                             | All products, filtered       |
| `/shop/vibrators`                   | Category                     |
| `/shop/vibrators/wands`             | Nested category              |
| `/shop/vibrators/wands/aurora-wand` | Product detail               |
| `/search?q=…`                       | Search results (`noindex`)   |
| `/compare`                          | Comparison table (`noindex`) |

All four live in **one catch-all** —
[`src/app/(storefront)/shop/[[...path]]/page.tsx`](<../src/app/(storefront)/shop/[[...path]]/page.tsx>).
It resolves a path to a category first, then to a product.

**Why one route.** A product sitting in three categories must not exist at three
URLs. Every product has a `primaryCategoryId`, which produces exactly one
canonical path via `productHref()`. Without that, the catalogue silently triples
its URL count and splits its own ranking signals.

### Known limitation: invalid paths soft-404

**An unresolvable path under `/shop` renders the 404 page with a `200` status and
a `noindex, nofollow` tag.** This is verified behaviour, not a guess, and it is a
Next constraint rather than a bug in the resolution logic.

The route reads `searchParams` (filters, sort, pagination), which makes it
dynamic and streamed. Once Next has begun sending the layout the status code is
fixed, so **none** of these can set a 404:

| Attempted                                      | Result                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `permanentRedirect()` in the page body         | 200 + `<meta http-equiv="refresh">` — a _soft redirect_, which consolidates nothing while appearing to |
| `notFound()` in the page body                  | 200 + 404 page                                                                                         |
| `notFound()` in `generateMetadata`             | 200 + 404 page                                                                                         |
| `generateStaticParams` + `dynamicParams: true` | 200 for anything not prerendered                                                                       |

The mitigation in place is the `noindex, nofollow` tag, which is what actually
keeps these URLs out of the index. Exposure is limited because **nothing generates
a non-canonical URL** — `productHref()` builds every internal link, the sitemap
and the canonical tag — so it takes a hand-edited address or a scraper to reach one.

**The proper fix, when it matters:** split the route. Product detail does not need
`searchParams` once review pagination moves to a path segment
(`/…/aurora-wand/reviews/2`) or to a client fetch. A product-only route with
`dynamicParams: false` resolves at the routing layer and returns a real 404.
Listings keep `searchParams` and stay dynamic, which is correct for them anyway.

**If a product is recategorised**, add its old URL to `redirects()` in
`next.config.ts` — that runs before rendering and does emit a real 308.

---

## The three ideas that make it scale

### 1. Denormalised sort keys

`Product` carries `minPriceCents`, `maxPriceCents`, `ratingAverage`,
`ratingCount`, `soldCount` and `isOnSale`. Every sort and price filter reads a
column on the row being sorted — no aggregate over variants, reviews or order
items.

Maintained by `priceRange()` and `recalculateProductRating()`. **If those are not
called after a write, the grid and the product page disagree**, which is the one
failure mode of this approach.

### 2. Facet tokens

`Product.facets` is a GIN-indexed `text[]` of `namespace:value` strings:

```
["brand:lumen", "category:vibrators", "material:platinum-cure-silicone",
 "color:rose", "tag:waterproof", "rating:4", "flag:sale"]
```

Filtering by colour through `VariantSelection → Variant → Product` costs three
joins _per facet_. One `facets hasSome [...]` predicate is a single index scan for
any combination.

**The rule that matters:** values within one namespace are OR-ed ("red or blue"),
namespaces are AND-ed ("red AND silicone"). Reversed, the panel returns nothing
as soon as two colours are ticked — the classic faceted-search bug. Encoded in
`buildProductWhere`.

Rebuild tokens whenever a source relation changes. Rating uses floor tokens, so
`rating:4` means "4 stars and up" and a "4 & up" filter is one token match rather
than a range scan.

### 3. Narrow selects

`CARD_SELECT` in
[`product.service.ts`](../src/services/product.service.ts) is the complete field
set a listing card needs. Adding to it is the easiest way to make every listing
page slower.

---

## Pagination

Both, deliberately:

- **Offset** (`?page=2`) for listing pages — crawlable, linkable, shareable.
- **Cursor** (`?cursor=…`) for infinite scroll — constant-time however deep the
  customer scrolls. `OFFSET 90000` scans 90,000 rows to return 24.

Every sort ends with `id` as a tiebreaker, without which keyset paging can skip
or repeat rows.

---

## Facet counts

`getFacetCounts` is raw SQL: one `unnest` + `GROUP BY` over the filtered set.
Doing it through the ORM means pulling every matching row into Node to tally its
array — fine at 17 products, catastrophic at 100k.

Counts are computed **with the current filter applied**, so an option showing
"(0)" is genuinely unavailable in combination with what is already selected.
A ticked option is never disabled, so the customer can always untick their way
back out.

---

## Search

Postgres full-text, not a hosted service. At this size a GIN index over
`to_tsvector('english', content)` answers in single-digit milliseconds, costs
nothing, and has no sync pipeline that can silently drift.

Three tiers in `rankedProductIds`:

1. **`websearch_to_tsquery`** — quoted phrases and `-exclusions`, as a customer
   expects from a search box.
2. **Prefix** (`vibr:*`) — matches while they are still typing.
3. **Trigram similarity** — so "vibrater" finds "vibrator" rather than returning
   nothing, which is when visitors leave. Floor of 0.3; below that, matches are
   noise. Applied to the title only, because running it over the whole document
   produces confident nonsense.

English stemming means many typos are caught by tier 1 alone — "vibrater" and
"vibrator" both stem to `vibrat`.

`ProductSearchDocument.content` repeats the title once, which gives title matches
a higher `ts_rank` without weighted vectors at query time.

### Preparing for semantic search

`searchProducts` is the single entry point and `rankedProductIds` is the only
thing that knows how ranking works. To add vector search: an
`embedding vector(1536)` column, an HNSW index, a cosine-distance `ORDER BY`, then
blend the two scores. **Nothing above that function changes.**

`SearchQuery` records every term with its result count, which powers popular and
trending suggestions and gives merchandising a zero-result report.

---

## Prices

Three fields on `Variant`, because a storefront answers three questions:

| Field                 | Meaning                           |
| --------------------- | --------------------------------- |
| `priceCents`          | Everyday list price               |
| `salePriceCents`      | Active promotional price, or null |
| `compareAtPriceCents` | MSRP anchor for a strike-through  |

Effective price is `salePriceCents ?? priceCents`. **Never re-derive that
inline** — use `effectivePriceCents()` / `resolvePrice()` so a sale price cannot
be shown on the listing and charged at list price in the cart.

A check constraint enforces `salePriceCents <= priceCents`: a "sale" above list
is a merchandising error, not a sale.

## Stock

Available stock is `quantity - reserved`, never the raw quantity — units held by
an in-flight checkout are already spoken for, and showing them is how two
customers buy the last item. `stockStatus()` derives `IN_STOCK` / `LOW_STOCK` /
`OUT_OF_STOCK` / `BACKORDER`.

The product page recomputes the range on read rather than trusting the
denormalised columns. A listing can be a millisecond stale; the page that takes
the money cannot.

---

## Browser-local lists

Wishlist, compare and recently-viewed are the same problem three times: an
ordered, capped, de-duplicated id list that survives a reload. One store factory
in [`local-list.ts`](../src/features/catalog/local-list.ts), three instances.

Built on `useSyncExternalStore` so the header badge and every card agree, with a
correct server snapshot for hydration. Cross-tab `storage` events are handled, so
a wishlist open in two tabs does not diverge.

**Why local rather than the database.** A guest has no user row, and asking
someone to register before they can save an item loses the save. Signed-in
customers additionally get `Wishlist` / `RecentlyViewed` rows; merging the two on
sign-in is a later phase.

Caps: wishlist 100, compare 4, recently viewed 20. Compare is capped
server-side too — a client-side cap alone is a suggestion.

---

## SEO

| Concern            | Where                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Canonical URL      | `productHref()` — one helper, used by pages, API and sitemap            |
| Non-canonical path | 301 redirect in the shop route                                          |
| Filtered listings  | `noindex` via `isUnfiltered()`                                          |
| Paginated listings | Canonical includes `?page=N`                                            |
| Search results     | Always `noindex`                                                        |
| Product schema     | `productSchema()` — Product, Offer/AggregateOffer, AggregateRating      |
| Breadcrumbs        | One `trail` array feeds both the visible component and `BreadcrumbList` |
| Sitemap            | Products, categories and collections at their canonical URLs            |

**Why filtered listings are `noindex`.** Six facets with four values each is
4,096 URL combinations of near-identical content. Indexing them dilutes the
category page they were reached from and burns crawl budget that belongs to
product pages.

Internal linking: category pages link to their children and siblings, products
link to their brand and tags, related and frequently-bought-together rails link
across the catalogue. Sibling links are how crawl equity reaches deep pages the
navigation does not list.

---

## Verifying it works

```bash
npm run db:verify        # tables, functional indexes, check constraints, row counts
npm run smoke:catalog    # 27 checks against the live database
```

`smoke:catalog` covers what a type-check cannot: raw-SQL facet counts, full-text
ranking, the trigram fallback, and that a facet's advertised count matches what
filtering by it actually returns.

It needs `--conditions=react-server` because the services import `server-only`,
which throws by design outside a Server Component context.

---

## Deliberate omissions

| Not built                        | Why, and when                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add to cart                      | Cart phase. The button is present but disabled, so the layout is final.                                                                             |
| Review submission                | Needs the account area. Reads, moderation and the rollup are done.                                                                                  |
| Wishlist/compare sync on sign-in | Needs the account area. Both persist locally today.                                                                                                 |
| Vector search                    | Needs real traffic to tune. The seam is `rankedProductIds`.                                                                                         |
| Chunked sitemaps                 | Needed above ~5,000 products. `listProductSlugs` caps rather than truncating silently.                                                              |
| Real images                      | `MediaPlaceholder` renders a deterministic gradient from `Media.publicId`. Swapping in `next/image` keeps the same aspect ratio, so nothing shifts. |
