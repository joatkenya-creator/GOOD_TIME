# Design system

**Brand personality:** elegant, modern, premium, confident, minimal,
professional, welcoming, sophisticated.

This is a sex toy retailer for adults in the US. The design has to read as
_considered_ rather than coy or seedy — closer to a fine fragrance counter than a
novelty shop. In practice that means restraint: one accent colour used sparingly,
generous whitespace, a serif display face for warmth, and no shouting.

The same discipline applies to language. Copy uses plain product nouns and real
specifications — material, decibel level, insertable length, charge time — never
euphemism or innuendo. In this category credibility _is_ the premium signal:
what converts a cautious first-time buyer is a spec sheet they can check and a
packaging promise they can verify, not adjectives.

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css) and are the
only place brand values are defined. Component index:
[components.md](components.md).

---

## Tailwind v4, CSS-first

There is no `tailwind.config.ts`. Tailwind v4 reads `@theme` from CSS, and every
token declared there becomes both a custom property and a utility class:

```css
@theme {
  --color-brand-500: #e91e63;
}
```

```tsx
<div className="border-brand-500 bg-brand-500 text-brand-500" />
```

---

## Colour

### Brand ramp

| Token             | Hex       | Role                                          |
| ----------------- | --------- | --------------------------------------------- |
| `brand-50`        | `#FDF2F7` | Tinted section backgrounds                    |
| `brand-100`       | `#FCE4EC` | **Brand light pink.** Badges, focus rings     |
| `brand-200`–`400` |           | Illustration and gradient steps               |
| `brand-500`       | `#E91E63` | Brand primary. Illustration and marketing art |
| `brand-600`       | `#D81B60` | **`accent`.** CTA buttons, active states      |
| `brand-700`       | `#C2185B` | **`accent-hover`**, and pink text on white    |
| `brand-800`–`950` |           | Deep accents, selection text                  |

### Neutral ramp

| Token     | Hex       | Role                             |
| --------- | --------- | -------------------------------- |
| `ink-50`  | `#F5F5F5` | **Light grey** — muted surface   |
| `ink-200` | `#E5E5E5` | **Default border**               |
| `ink-300` | `#CCCCCC` | Strong border                    |
| `ink-400` | `#999999` | Decorative only — never text     |
| `ink-450` | `#707070` | **`foreground-subtle`** — quiet text |
| `ink-500` | `#666666` | **Medium grey** — secondary text |
| `ink-700` | `#333333` | **Dark grey** — body text        |
| `ink-900` | `#1A1A1A` | Inverse surface, modal backdrop  |

### Feedback

| Token         | Hex       |
| ------------- | --------- |
| `success-500` | `#4CAF50` |
| `warning-500` | `#FF9800` |
| `danger-500`  | `#F44336` |
| `info-500`    | `#2563EB` |

Each has a `-50` tint and a `-700` text tone so the pairing is always AA.

### Semantic aliases

Components reference these, never the raw ramp. A rebrand touches one block.

| Alias                   | Resolves to |
| ----------------------- | ----------- |
| `background`, `surface` | `white`     |
| `surface-muted`         | `ink-50`    |
| `surface-inverse`       | `ink-900`   |
| `foreground`            | `ink-700`   |
| `foreground-muted`      | `ink-500`   |
| `foreground-subtle`     | `ink-450`   |
| `border`                | `ink-200`   |
| `border-strong`         | `ink-300`   |
| `accent`                | `brand-600` |
| `accent-hover`          | `brand-700` |
| `accent-soft`           | `brand-50`  |
| `accent-muted`          | `brand-100` |
| `accent-text`           | `brand-700` |
| `ring`                  | `brand-500` |

**The rule:** `bg-accent`, not `bg-brand-500`, in application code.

### Contrast

Every text and surface pairing clears WCAG AA. Three of them did not until an
axe-core sweep said so, and the reasons they slipped are worth keeping.

**`accent` is `brand-600`, not the brand primary.** `#E91E63` is **4.34:1**
against white. This file used to argue that was acceptable because white on
accent only appeared "at the 18.66px+ semibold sizes used for large CTAs" — and
then documented the one-line fix for anyone wanting strict AA. The sweep found
16px normal-weight submit buttons on that background across the cart, the
newsletter form and guest order lookup. The exception had quietly become the
common case, so the one-line fix is now simply the default: `#D81B60` is
**4.95:1** and is the brand's own hover shade, so the palette lost nothing.

**`foreground-subtle` is `#707070`, not `#999999`.** At 2.84:1 the old value
failed by a wide margin while carrying timestamps, table headers, helper text
and card metadata on every page — 46 instances on the shop page alone. "Subtle"
described how it looked to someone who could already read it. `#707070` is the
lightest grey that clears 4.5:1 on **both** white and the `#F5F5F5` muted
surface, which is where this text actually sits; anything lighter passes on one
and fails on the other.

**`warning-700` is `#C2410C`, not `#E65100`.** 3.78:1, used for low-stock
warnings — text that exists specifically to be noticed.

`ink-400` survives for borders and decorative marks. It is not a text colour and
the alias no longer points at it.

Verified pairings: `foreground` on white 12.6:1 · `foreground-muted` on white
5.74:1 · `foreground-subtle` on white 4.95:1, on `#F5F5F5` 4.54:1 · `accent-text`
on white 5.85:1 · white on `accent` 4.95:1 · white on `ink-900` 16.1:1.

`npm run verify:quality` re-runs axe-core over every page at three viewports, so
the next regression fails a check rather than waiting for a complaint.

---

## Typography

Two faces, loaded through `next/font` (self-hosted, zero layout shift):

| Role    | Face             | Variable         | Used for                |
| ------- | ---------------- | ---------------- | ----------------------- |
| Body    | Inter            | `--font-body`    | Everything              |
| Display | Playfair Display | `--font-heading` | `h1`–`h3`, the elegance |

`h1`, `h2` and `h3` pick up the display face automatically from the base layer.
Use `font-display` explicitly when a `<p>` needs the same treatment.

### Fluid display scale

`clamp()` rather than breakpoint jumps, so headings stay proportional from a
360px phone to an ultra-wide monitor with no snapping.

| Token              | Range           |
| ------------------ | --------------- |
| `text-display-2xl` | 2.75 → 5.25rem  |
| `text-display-xl`  | 2.25 → 3.75rem  |
| `text-display-lg`  | 1.875 → 2.75rem |
| `text-display-md`  | 1.5 → 2rem      |
| `text-display-sm`  | 1.25 → 1.5rem   |

### Body scale

`text-body-lg` (18px), `text-body` (16px), `text-body-sm` (14px) — all at 1.6–1.7
line height, because this is a reading experience.

`text-eyebrow` is the small letter-spaced uppercase label above headings. It is a
token rather than a utility stack so it stays identical everywhere.

---

## Shape, elevation, motion

**Radii** — `xs` 4px through `3xl` 40px. Buttons and inputs use `lg` (14px):
soft, not pill-shaped. Cards use `xl`/`2xl`; full-bleed panels use `3xl`.

**Shadows** — tinted with the ink colour, low opacity. `shadow-brand` is the pink
glow reserved for a primary button on hover. Nothing gets a hard drop shadow.

**Motion** — one easing curve (`--ease-brand`, `cubic-bezier(0.32, 0.72, 0, 1)`)
and three durations (150 / 250 / 400ms). Consistency here is what reads as craft.
`prefers-reduced-motion` is honoured globally in `globals.css`, and every Framer
component additionally checks `useReducedMotion()` so JS-driven animation stops
too.

**The animation budget:** entrance reveals fire once (`viewport={{ once: true }}`),
hover effects are transform and colour only, and nothing loops. Re-animating on
every scroll-by is the fastest way to make a premium site feel like a demo.

---

## Layout

| Token                 | Value   | Use                                      |
| --------------------- | ------- | ---------------------------------------- |
| `--container-shell`   | 90rem   | Site shell — header, most sections       |
| `--container-content` | 44rem   | Editorial measure — articles, auth forms |
| `--container-wide`    | 104rem  | Ultra-wide breakout                      |
| `--spacing-gutter`    | 1.25rem | Mobile side padding                      |
| `--spacing-section`   | 5rem    | Vertical rhythm between sections         |

Breakpoints are Tailwind's defaults; `BREAKPOINTS` in
[`use-media-query.ts`](../src/hooks/use-media-query.ts) mirrors them so JS and CSS
agree on where "desktop" starts.

Utilities in `globals.css`: `.snap-rail` (carousel), `.full-bleed` (escape a
container without the `100vw` scrollbar bug), `.animate-shimmer` (skeletons),
`.skip-link`.

---

## Accessibility

Non-negotiable, and already wired:

- Visible focus ring on `:focus-visible` only, using the brand colour.
- Skip link in the root layout, targeting the `#main` the storefront layout owns.
- One `<main>` and one `<h1>` per page.
- `FormField` wires `<label for>`, `aria-invalid`, `aria-describedby` (hint _and_
  error) and `role="alert"` — the four things hand-rolled fields always miss.
- Icons are `aria-hidden`; icon-only buttons carry an `aria-label`.
- `maximumScale: 5` — pinch-to-zoom is an accessibility requirement, not a bug.
- Skeletons are `aria-hidden`; the enclosing region carries `aria-busy`.
- Carousels are focusable `region`s so keyboard users can pan them.
- Every "opens in a new tab" link says so in an `sr-only` span.
- `prefers-reduced-motion` disables animation globally and per-component.

---

## Adding a component

1. Does an existing one cover it with a new variant? Add the variant.
2. Is it generic, or commerce-specific? `ui/` versus `product/`.
3. Can a native element do it? Check before reaching for state.
4. Use `cva` for variants; never accept a raw `style` prop.
5. Accept and merge `className` through `cn()`.
6. Reference semantic tokens, never raw ramp values or hex codes.
7. Export it from `components/ui/index.ts` and list it in
   [components.md](components.md).
