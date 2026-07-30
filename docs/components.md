# Component library

Every component is reusable, typed and documented at its definition. This page is
the index; the _why_ lives in the doc comment at the top of each file.

Import primitives from the barrel, everything else by path:

```tsx
import { Button, Price, Rating } from '@/components/ui';
import { ProductCard } from '@/components/product/product-card';
```

---

## Primitives — `src/components/ui/`

| Component                    | File                                                    | Notes                                                               |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `Button`                     | [button.tsx](../src/components/ui/button.tsx)           | 7 variants × 4 sizes, `asChild`, built-in loading state             |
| `Input`                      | [input.tsx](../src/components/ui/input.tsx)             | Leading/trailing icons; derives invalid styling from `aria-invalid` |
| `Textarea`                   | [textarea.tsx](../src/components/ui/textarea.tsx)       | Shares `fieldVariants` with `Input`                                 |
| `Select`                     | [select.tsx](../src/components/ui/select.tsx)           | Native `<select>` with a custom chevron                             |
| `Checkbox`                   | [checkbox.tsx](../src/components/ui/checkbox.tsx)       | Native, tinted via `accent-color`                                   |
| `Radio`, `RadioGroup`        | [radio.tsx](../src/components/ui/radio.tsx)             | `RadioGroup` wraps in `<fieldset>`/`<legend>`                       |
| `Badge`                      | [badge.tsx](../src/components/ui/badge.tsx)             | 8 variants — read-only label                                        |
| `Chip`                       | [chip.tsx](../src/components/ui/chip.tsx)               | Interactive filter pill with `aria-pressed`                         |
| `Card` + parts               | [card.tsx](../src/components/ui/card.tsx)               | `CardHeader/Title/Description/Content/Footer`                       |
| `Alert`                      | [alert.tsx](../src/components/ui/alert.tsx)             | `role="alert"` on danger, `status` otherwise                        |
| `Modal`                      | [modal.tsx](../src/components/ui/modal.tsx)             | Native `<dialog>` + Framer entrance                                 |
| `Drawer`                     | [drawer.tsx](../src/components/ui/drawer.tsx)           | Native `<dialog>`, slides from left/right/bottom                    |
| `Dropdown`, `DropdownItem`   | [dropdown.tsx](../src/components/ui/dropdown.tsx)       | Escape + outside-click close, focus returns to trigger              |
| `Tooltip`                    | [tooltip.tsx](../src/components/ui/tooltip.tsx)         | Hover **and** focus; injects `aria-describedby`                     |
| `Tabs`                       | [tabs.tsx](../src/components/ui/tabs.tsx)               | Full ARIA tabs pattern with roving `tabIndex`                       |
| `Accordion`, `AccordionItem` | [accordion.tsx](../src/components/ui/accordion.tsx)     | Native `<details>`; `group` prop makes it exclusive                 |
| `Pagination`                 | [pagination.tsx](../src/components/ui/pagination.tsx)   | Real links, collapsing `1 … 4 5 6 … 20` window                      |
| `Carousel`                   | [carousel.tsx](../src/components/ui/carousel.tsx)       | CSS scroll-snap rail, focusable, arrow buttons                      |
| `Price`                      | [price.tsx](../src/components/ui/price.tsx)             | Cents in, currency out; `<s>` was-price, discount %                 |
| `Rating`                     | [rating.tsx](../src/components/ui/rating.tsx)           | Fractional stars by clipping; value exposed as text                 |
| `Skeleton`, `SkeletonText`   | [skeleton.tsx](../src/components/ui/skeleton.tsx)       | `aria-hidden`; region carries `aria-busy`                           |
| `Spinner`                    | [spinner.tsx](../src/components/ui/spinner.tsx)         | CSS-only                                                            |
| `EmptyState`                 | [empty-state.tsx](../src/components/ui/empty-state.tsx) | Requires an `action`                                                |
| `ToastProvider`, `useToast`  | [toast.tsx](../src/components/ui/toast.tsx)             | One `aria-live` region for the whole stack                          |
| `Slot`                       | [slot.tsx](../src/components/ui/slot.tsx)               | The `asChild` primitive                                             |

## Commerce cards — `src/components/product/`

| Component            | File                                                                           | Notes                                                   |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ProductCard`        | [product-card.tsx](../src/components/product/product-card.tsx)                 | Server component; one stretched link for the whole tile |
| `ProductCardActions` | [product-card-actions.tsx](../src/components/product/product-card-actions.tsx) | The only client island — wishlist + quick view          |
| `CategoryCard`       | [category-card.tsx](../src/components/product/category-card.tsx)               | Gradient scrim keeps label contrast above 4.5:1         |
| `CollectionCard`     | [collection-card.tsx](../src/components/product/collection-card.tsx)           | Editorial row, `reversed` for alternating layouts       |
| `BlogCard`           | [blog-card.tsx](../src/components/product/blog-card.tsx)                       | Machine-readable `<time datetime>`                      |
| `ReviewCard`         | [review-card.tsx](../src/components/product/review-card.tsx)                   | `<figure>`/`<blockquote>`/`<figcaption>`                |

## Layout, navigation and shared — `src/components/`

| Component          | File                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `Header`           | [layout/header.tsx](../src/components/layout/header.tsx)                             |
| `Footer`           | [layout/footer.tsx](../src/components/layout/footer.tsx)                             |
| `Container`        | [layout/container.tsx](../src/components/layout/container.tsx)                       |
| `Section`          | [layout/section.tsx](../src/components/layout/section.tsx)                           |
| `MegaMenu`         | [navigation/mega-menu.tsx](../src/components/navigation/mega-menu.tsx)               |
| `MobileNav`        | [navigation/mobile-nav.tsx](../src/components/navigation/mobile-nav.tsx)             |
| `AnnouncementBar`  | [navigation/announcement-bar.tsx](../src/components/navigation/announcement-bar.tsx) |
| `SearchBar`        | [navigation/search-bar.tsx](../src/components/navigation/search-bar.tsx)             |
| `Breadcrumbs`      | [navigation/breadcrumbs.tsx](../src/components/navigation/breadcrumbs.tsx)           |
| `FormField`        | [forms/form-field.tsx](../src/components/forms/form-field.tsx)                       |
| `SubmitButton`     | [forms/submit-button.tsx](../src/components/forms/submit-button.tsx)                 |
| `NewsletterForm`   | [forms/newsletter-form.tsx](../src/components/forms/newsletter-form.tsx)             |
| `AgeGate`          | [common/age-gate.tsx](../src/components/common/age-gate.tsx)                         |
| `PromoBanner`      | [common/promo-banner.tsx](../src/components/common/promo-banner.tsx)                 |
| `FeatureCard`      | [common/feature-card.tsx](../src/components/common/feature-card.tsx)                 |
| `MediaPlaceholder` | [common/media-placeholder.tsx](../src/components/common/media-placeholder.tsx)       |
| `JsonLd`           | [common/json-ld.tsx](../src/components/common/json-ld.tsx)                           |
| `Analytics`        | [common/analytics.tsx](../src/components/common/analytics.tsx)                       |
| `Reveal`           | [motion/reveal.tsx](../src/components/motion/reveal.tsx)                             |
| `Counter`          | [motion/counter.tsx](../src/components/motion/counter.tsx)                           |

## Homepage sections — `src/components/home/`

`HeroSection` · `CategoriesSection` · `BestSellersSection` · `CollectionsSection`
· `WhyShopSection` · `PromoSection` · `TrendingSection` · `ReviewsSection` ·
`ValuesSection` · `JournalSection` · `NewsletterSection` · `GallerySection`

All are server components. Content comes from
[`src/features/home/content.ts`](../src/features/home/content.ts) — swap that file
for database queries in a later phase without touching a component.

---

## Conventions

**Server by default.** A component only gets `'use client'` when it needs state,
an event handler or a browser API. Where a mostly-static component needs one
interactive corner, that corner becomes its own island — `ProductCard` /
`ProductCardActions` is the reference example.

**Native platform first.** `<dialog>` for modals and drawers, `<details>` for
accordions, `<select>` for selects, `accent-color` for checkboxes and radios, CSS
scroll-snap for carousels. Each saves a dependency _and_ gets the accessibility
contract right by default.

**Variants via `cva`, never a `style` prop.** Every component merges an incoming
`className` through `cn()` so callers can adjust spacing without forking it.

**Semantic tokens only.** Use `bg-accent`, not `bg-brand-500`; `text-foreground-muted`,
not `text-ink-500`. See [design-system.md](design-system.md).

**Derive, don't sync.** No `setState` inside an effect to mirror a prop or a
route. `MobileNav` stores the path it was opened on; `SearchBar` stores the query
its highlight belongs to. Both are enforced by `react-hooks/set-state-in-effect`.

**One stretched link per card.** Cards use a `before:absolute before:inset-0`
pseudo-element on the title link so the whole tile is clickable while exposing a
single, sensible accessible name.
