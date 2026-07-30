'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the close button for flows the user must complete (age gate). */
  dismissible?: boolean;
}

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * Modal dialog.
 *
 * Built on the native `<dialog>` element, which the platform gives us for free:
 * focus trapping, inert background, Escape handling, and top-layer stacking that
 * no `z-index` can break. Framer Motion supplies the entrance only.
 *
 * The alternative — a portal, a focus-trap library and a scroll-lock hook — is
 * roughly 200 lines and three dependencies to reproduce what the browser does.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Fires for Escape and for programmatic `close()`; keeps React state in sync.
    const handleClose = () => onClose();
    // Escape must not dismiss a non-dismissible dialog.
    const handleCancel = (event: Event) => {
      if (!dismissible) event.preventDefault();
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="modal-title"
      aria-describedby={description ? 'modal-description' : undefined}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-xl bg-surface p-0 text-foreground shadow-xl backdrop:bg-ink-900/50 backdrop:backdrop-blur-sm',
        SIZES[size],
      )}
      // Clicking the backdrop closes; clicks inside the panel stop propagating.
      onClick={(event) => {
        if (dismissible && event.target === dialogRef.current) onClose();
      }}
    >
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="p-6 sm:p-8"
          >
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-2">
                <h2 id="modal-title" className="font-display text-2xl leading-tight tracking-tight">
                  {title}
                </h2>
                {description ? (
                  <p
                    id="modal-description"
                    className="text-sm leading-relaxed text-foreground-muted"
                  >
                    {description}
                  </p>
                ) : null}
              </div>

              {dismissible ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="-mt-2 -mr-2 shrink-0"
                >
                  <X />
                </Button>
              ) : null}
            </div>

            {children ? <div className="mt-6 text-sm">{children}</div> : null}
            {footer ? <div className="mt-8 flex justify-end gap-3">{footer}</div> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}
