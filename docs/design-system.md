# Design system

**Brand personality:** elegant, modern, premium, trustworthy, clean,
sophisticated, minimal.

This is an intimate wellness boutique for adults. The design has to read as
_considered_ rather than _coy_ or _clinical_ — closer to a fine fragrance
counter than to a novelty shop. In practice that means restraint: one accent
colour used sparingly, generous whitespace, a serif display face for warmth, and
no shouting.

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css) and are the
only place brand values are defined.

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

Pink, derived from the primary `#E91E63`.

| Token       | Hex       | Use                                          |
| ----------- | --------- | -------------------------------------------- |
| `brand-50`  | `#fdf2f6` | Tinted backgrounds, subtle badges            |
| `brand-100` | `#fce7ef` | Hover on tinted surfaces                     |
| `brand-500` | `#e91e63` | **Primary action.** The brand.               |
| `brand-600` | `#d01655` | Primary hover                                |
| `brand-700` | `#af0f46` | Text on light tint (passes AA on `brand-50`) |
| `brand-900` | `#7a1236` | Selection text                               |

### Neutral ramp

Anchored on the brief's dark grey `#333333` and light grey `#F5F5F5`.

| Token     | Hex       | Use                              |
| --------- | --------- | -------------------------------- |
| `ink-50`  | `#f5f5f5` | Muted surface                    |
| `ink-200` | `#d6d6d6` | Borders                          |
| `ink-300` | `#b8b8b8` | Strong borders                   |
| `ink-400` | `#8f8f8f` | Placeholder text                 |
| `ink-500` | `#6b6b6b` | Secondary text                   |
| `ink-700` | `#333333` | **Body text.** Inverse surfaces. |
| `ink-900` | `#171717` | Modal backdrop                   |

### Semantic aliases

Components reference these, never the raw ramp. A rebrand touches one block.

| Alias                   | Resolves to |
| ----------------------- | ----------- |
| `background`, `surface` | `white`     |
| `surface-muted`         | `ink-50`    |
| `foreground`            | `ink-700`   |
| `foreground-muted`      | `ink-500`   |
| `foreground-subtle`     | `ink-400`   |
| `border`                | `ink-200`   |
| `border-strong`         | `ink-300`   |
| `accent`                | `brand-500` |
| `accent-hover`          | `brand-600` |
| `accent-soft`           | `brand-50`  |
| `ring`                  | `brand-500` |

**The rule:** `bg-accent`, not `bg-brand-500`, in application code.

### Feedback

`success`, `warning`, `danger`, `info`, each with a `-50` tint, a `-500` base
and a `-700` text tone. Used by `Alert` and `Badge`.

---

## Typography

Two faces, loaded through `next/font` (self-hosted, zero layout shift):

| Role    | Face             | Variable         | Used for                |
| ------- | ---------------- | ---------------- | ----------------------- |
| Body    | Inter            | `--font-body`    | Everything              |
| Display | Playfair Display | `--font-heading` | `h1`–`h3`, the elegance |

`h1`, `h2` and `h3` pick up the display face automatically from the base layer.
Use `font-display` explicitly when a `<p>` needs the same treatment.

### Fluid display sizes

Clamped so a large heading stays large on desktop and readable on a 360px phone,
with no breakpoint jumps:

| Token              | Range           |
| ------------------ | --------------- |
| `text-display-2xl` | 2.75 → 5rem     |
| `text-display-xl`  | 2.25 → 3.75rem  |
| `text-display-lg`  | 1.875 → 2.75rem |
| `text-display-md`  | 1.5 → 2rem      |

`text-eyebrow` is the small, letter-spaced, uppercase label that sits above a
heading. It is a token rather than a utility stack so it stays identical
everywhere.

---

## Shape, elevation, motion

**Radii** — `xs` 4px through `2xl` 28px. Buttons and inputs use `lg` (14px):
soft, not pill-shaped.

**Shadows** — tinted with the ink colour and kept low-opacity. `shadow-brand` is
the pink glow reserved for a primary button on hover. Nothing gets a hard drop
shadow.

**Motion** — one easing curve (`--ease-brand`, `cubic-bezier(0.32, 0.72, 0, 1)`)
and three durations (150 / 250 / 400ms). Consistency here is what reads as craft.
`prefers-reduced-motion` is honoured globally in `globals.css`, so it applies to
Framer Motion too.

---

## Components

All exported from `@/components/ui`.

| Component    | Notes                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `Button`     | 7 variants × 4 sizes. `asChild` for link-buttons. Built-in loading state.                            |
| `Input`      | Optional leading/trailing icons. Derives its invalid style from `aria-invalid`.                      |
| `Textarea`   | Shares `fieldVariants` with `Input`.                                                                 |
| `Select`     | Native `<select>` with a custom chevron.                                                             |
| `Checkbox`   | Native, brand-tinted via `accent-color`.                                                             |
| `Badge`      | 8 variants. Quiet by default — a grid of shouting badges reads as a discount site.                   |
| `Card`       | Plus `CardHeader/Title/Description/Content/Footer`.                                                  |
| `Alert`      | `role="alert"` on `danger`, `role="status"` otherwise.                                               |
| `Modal`      | Native `<dialog>`: focus trap, inert background, Escape, top-layer stacking — all from the platform. |
| `Skeleton`   | Plus `SkeletonText` with a ragged last line.                                                         |
| `Spinner`    | CSS-only.                                                                                            |
| `EmptyState` | Requires an `action`. An empty state without a way out is a dead end.                                |
| `Slot`       | The `asChild` primitive. 12 lines instead of a Radix dependency.                                     |

### Why native elements

`<dialog>` gives focus trapping, an inert background, Escape handling and
top-layer stacking that no `z-index` can break. Reproducing that with a portal, a
focus-trap library and a scroll-lock hook is ~200 lines and three dependencies.
Same reasoning for `<select>` and `accent-color`.

The moment a design genuinely needs a custom listbox — colour swatches in a
dropdown, search-in-list — add the library. Not before.

---

## Accessibility

Non-negotiable, and already wired:

- Visible focus ring on `:focus-visible` only, using the brand colour.
- Skip link in the root layout.
- `FormField` wires `<label for>`, `aria-invalid`, `aria-describedby` (hint _and_
  error) and `role="alert"` — the four things hand-rolled fields always miss.
- Icons are `aria-hidden`; icon-only buttons carry an `aria-label`.
- `maximumScale: 5` — pinch-to-zoom is an accessibility requirement, not a bug.
- Skeletons are `aria-hidden`; the enclosing region carries `aria-busy`.
- `prefers-reduced-motion` disables animation globally.

Text colour pairings in the tables above meet WCAG AA at body size. Verify any
new pairing before shipping it.

---

## Adding a component

1. Does an existing one cover it with a new variant? Add the variant.
2. Is it generic, or commerce-specific? `ui/` versus `product/`, `cart/`.
3. Use `cva` for variants; never accept a raw `style` prop.
4. Accept and merge `className` through `cn()` so callers can adjust spacing.
5. Reference semantic tokens, never raw ramp values or hex codes.
6. Export it from `components/ui/index.ts`.
