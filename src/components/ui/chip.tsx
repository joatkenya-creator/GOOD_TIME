'use client';

import { X } from 'lucide-react';

import { cn } from '@/utils/cn';

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onSelect'> {
  label: string;
  /** Renders as a toggle button rather than static text. */
  selected?: boolean;
  onSelect?: () => void;
  /** Adds a remove affordance — for applied filters. */
  onRemove?: () => void;
  count?: number;
}

/**
 * Chip — a filter pill.
 *
 * Distinct from `Badge`: a badge is a read-only label, a chip is interactive and
 * carries `aria-pressed` so its state is announced.
 */
export function Chip({
  label,
  selected,
  onSelect,
  onRemove,
  count,
  className,
  ...props
}: ChipProps) {
  const base = cn(
    'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium',
    'transition-colors duration-(--duration-fast) ease-(--ease-brand)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
    selected
      ? 'border-accent bg-accent-soft text-accent-text'
      : 'border-border text-foreground-muted hover:border-border-strong hover:text-foreground',
    className,
  );

  if (onRemove) {
    return (
      <span className={base} {...props}>
        {label}
        {/* 24x24 pressable area per WCAG 2.5.8; the icon itself stays small. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          className="-mr-2 flex size-6 shrink-0 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-ink-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--color-ring)"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </span>
    );
  }

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} aria-pressed={selected} className={base} {...props}>
        {label}
        {count !== undefined ? (
          <span className="text-xs text-foreground-subtle">{count}</span>
        ) : null}
      </button>
    );
  }

  return (
    <span className={base} {...props}>
      {label}
    </span>
  );
}
