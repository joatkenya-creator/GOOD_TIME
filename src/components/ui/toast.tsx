'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { cn } from '@/utils/cn';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const STYLES: Record<ToastVariant, string> = {
  success: 'text-success-700',
  error: 'text-danger-700',
  warning: 'text-warning-700',
  info: 'text-info-700',
};

const AUTO_DISMISS_MS = 5000;

let nextId = 0;

/**
 * Toast notifications.
 *
 * The viewport is a single `aria-live` region rather than one per toast, so a
 * screen reader announces new messages without re-reading the whole stack.
 * Errors use `assertive`; everything else is `polite` and will not interrupt.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((current) => [...current, { ...input, id }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-toast) flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((entry) => {
            const Icon = ICONS[entry.variant];

            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                role={entry.variant === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg"
              >
                <Icon
                  aria-hidden="true"
                  className={cn('mt-0.5 size-5 shrink-0', STYLES[entry.variant])}
                />

                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-foreground">{entry.title}</p>
                  {entry.description ? (
                    <p className="mt-0.5 text-body-sm text-foreground-muted">{entry.description}</p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(entry.id)}
                  aria-label="Dismiss notification"
                  className="-mt-1 -mr-1 rounded-md p-1 text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
