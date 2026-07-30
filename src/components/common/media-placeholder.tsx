import { cn } from '@/utils/cn';

export interface MediaPlaceholderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stable string — the same seed always produces the same gradient. */
  seed: string;
  /** Shown centred; omit for a plain tonal block. */
  label?: string;
  ratio?: 'product' | 'square' | 'portrait' | 'landscape' | 'banner' | 'auto';
  tone?: 'brand' | 'neutral' | 'mixed';
}

const RATIOS = {
  product: 'aspect-[3/4]',
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
  landscape: 'aspect-[4/3]',
  banner: 'aspect-[21/9]',
  auto: '',
} as const;

/**
 * Deterministic image placeholder.
 *
 * Phase 2 ships without photography, and grey boxes make a premium layout look
 * broken. This renders a soft duotone wash derived from a hash of `seed`, so
 * every card gets a distinct-but-coherent field that reads as intentional art
 * direction — and re-renders identically, which keeps SSR and hydration in sync.
 *
 * Replace with `next/image` once real assets land; the wrapper keeps the same
 * aspect ratio, so no layout shifts when it does.
 */
export function MediaPlaceholder({
  seed,
  label,
  ratio = 'product',
  tone = 'mixed',
  className,
  ...props
}: MediaPlaceholderProps) {
  const hash = hashString(seed);
  const angle = hash % 360;

  const palettes = {
    brand: [
      ['var(--color-brand-100)', 'var(--color-brand-200)'],
      ['var(--color-brand-50)', 'var(--color-brand-300)'],
    ],
    neutral: [
      ['var(--color-ink-100)', 'var(--color-ink-200)'],
      ['var(--color-ink-50)', 'var(--color-ink-300)'],
    ],
    mixed: [
      ['var(--color-brand-50)', 'var(--color-ink-200)'],
      ['var(--color-brand-100)', 'var(--color-ink-100)'],
      ['var(--color-ink-50)', 'var(--color-brand-200)'],
    ],
  } as const;

  const options = palettes[tone];
  const [from, to] = options[hash % options.length] ?? options[0];

  return (
    <div
      role="img"
      aria-label={label ? `Placeholder image: ${label}` : 'Placeholder image'}
      className={cn('relative isolate overflow-hidden bg-surface-muted', RATIOS[ratio], className)}
      style={{ backgroundImage: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }}
      {...props}
    >
      {/* Soft radial highlight so the field has depth rather than reading flat. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: `radial-gradient(60% 55% at ${30 + (hash % 40)}% ${25 + (hash % 30)}%, rgb(255 255 255 / 0.65), transparent 70%)`,
        }}
      />

      {label ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center p-6 text-center text-eyebrow text-ink-600/70 uppercase"
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Small, stable, non-cryptographic hash (djb2). */
function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
