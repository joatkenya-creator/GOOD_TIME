'use client';

import { Scale, X } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { useCompare } from '@/hooks/use-product-lists';

/**
 * Sticky compare tray.
 *
 * Appears only once something is selected, so it costs nothing until it is
 * relevant. Kept deliberately small — it sits above the content and must not
 * obscure the products the customer is still choosing between.
 */
export function CompareBar() {
  const compare = useCompare();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {compare.count > 0 ? (
        <motion.div
          initial={reduceMotion ? false : { y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? undefined : { y: 80, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-x-0 bottom-0 z-(--z-drawer) border-t border-border bg-surface/95 backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-(--container-shell) flex-wrap items-center justify-between gap-3 px-(--spacing-gutter) py-3.5 sm:px-8">
            <p className="flex items-center gap-2.5 text-body-sm text-foreground">
              <Scale aria-hidden="true" className="size-4 text-accent-text" />
              <span aria-live="polite">
                <span className="font-semibold">{compare.count}</span> of {compare.limit} selected
                to compare
              </span>
            </p>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={compare.clear}>
                <X aria-hidden="true" />
                Clear
              </Button>

              <Button size="sm" asChild disabled={compare.count < 2}>
                <Link href="/compare">Compare {compare.count < 2 ? '(pick 2+)' : ''}</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
