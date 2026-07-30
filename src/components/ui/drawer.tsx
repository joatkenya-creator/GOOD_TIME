'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: 'left' | 'right' | 'bottom';
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const PANEL: Record<NonNullable<DrawerProps['side']>, string> = {
  left: 'mr-auto h-dvh max-h-none w-[min(24rem,90vw)] rounded-r-2xl',
  right: 'ml-auto h-dvh max-h-none w-[min(24rem,90vw)] rounded-l-2xl',
  bottom: 'mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-2xl',
};

const CLOSED: Record<NonNullable<DrawerProps['side']>, string> = {
  left: '-translate-x-full',
  right: 'translate-x-full',
  bottom: 'translate-y-full',
};

/**
 * Slide-in panel — mobile navigation, filters, mini cart.
 *
 * Same foundation as `Modal`: a native `<dialog>`, so focus trapping, the inert
 * background, Escape and top-layer stacking all come from the platform. Only the
 * transform is ours.
 *
 * CSS transitions rather than Framer Motion here: the panel must animate *out*
 * before `dialog.close()` fires, and coordinating that with an exit animation
 * library costs more than the two classes below.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = 'right',
  children,
  footer,
  className,
}: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      // Let the slide-out play before removing the dialog from the top layer.
      const timer = setTimeout(() => dialog.close(), 250);
      return () => clearTimeout(timer);
    }
    return;
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // Locking the body prevents the page behind from scrolling on iOS, which
  // `<dialog>` alone does not handle.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'm-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-ink-900/50',
        'h-dvh w-dvw',
        'backdrop:transition-opacity backdrop:duration-(--duration-base)',
      )}
    >
      <div className={cn('flex h-full w-full', side === 'bottom' && 'flex-col')}>
        <div
          className={cn(
            'flex flex-col bg-surface shadow-xl',
            'transition-transform duration-(--duration-base) ease-(--ease-brand)',
            PANEL[side],
            !open && CLOSED[side],
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div className="space-y-1">
              <h2 className="font-display text-xl tracking-tight text-foreground">{title}</h2>
              {description ? (
                <p className="text-body-sm text-foreground-muted">{description}</p>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close panel"
              className="-mt-1 -mr-1 shrink-0"
            >
              <X />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">{children}</div>

          {footer ? <footer className="border-t border-border p-5">{footer}</footer> : null}
        </div>
      </div>
    </dialog>
  );
}
