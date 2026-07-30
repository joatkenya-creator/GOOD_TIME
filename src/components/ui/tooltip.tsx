'use client';

import { useId } from 'react';

import { Slot } from '@/components/ui/slot';
import { cn } from '@/utils/cn';

export interface TooltipProps {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * Tooltip.
 *
 * Shown on hover *and* on keyboard focus (`group-focus-within`) — a hover-only
 * tooltip is invisible to keyboard and touch users.
 *
 * `aria-describedby` is injected onto the trigger via `Slot`, so the text is
 * announced rather than merely drawn. Never put essential information in here;
 * a tooltip is a supplement, not a label.
 */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const id = useId();

  return (
    <span className={cn('group relative inline-flex', className)}>
      <Slot aria-describedby={id}>{children}</Slot>

      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-(--z-toast) w-max max-w-56 -translate-x-1/2 rounded-lg px-2.5 py-1.5',
          'bg-ink-900 text-center text-xs font-medium text-white shadow-md',
          'opacity-0 transition-opacity duration-(--duration-fast) ease-(--ease-brand)',
          'group-focus-within:opacity-100 group-hover:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+0.5rem)]' : 'top-[calc(100%+0.5rem)]',
        )}
      >
        {label}
      </span>
    </span>
  );
}
