'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

export interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
  label?: string;
}

/**
 * Dropdown menu.
 *
 * Closes on Escape, on outside click, and on any activation inside the panel —
 * that last one is what stops a menu hanging open after a link is followed.
 *
 * Focus returns to the trigger on Escape, so keyboard users are not dumped at
 * the top of the document.
 */
export function Dropdown({
  trigger,
  children,
  align = 'start',
  className,
  panelClassName,
  label,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            'absolute top-[calc(100%+0.5rem)] z-(--z-drawer) min-w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      role="menuitem"
      className={cn(
        'block rounded-lg px-3 py-2 text-body-sm text-foreground-muted',
        'transition-colors duration-(--duration-fast) hover:bg-surface-muted hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        className,
      )}
      {...props}
    />
  );
}
