'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { announcements } from '@/config/navigation';

const ROTATE_MS = 5000;
const STORAGE_KEY = 'gt.announcement';

/**
 * Dismissal state, modelled as an external store.
 *
 * `sessionStorage` genuinely is external state, so `useSyncExternalStore` is the
 * right tool: it gives a correct server snapshot for hydration and re-renders
 * subscribers when the value changes — without a `setState` inside an effect.
 *
 * Session-scoped rather than a cookie, so it needs no consent banner and
 * resurfaces on the visitor's next visit.
 */
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  cached ??= sessionStorage.getItem(STORAGE_KEY) === 'dismissed';
  return cached;
}

/** Server assumes not dismissed — true for almost every render. */
function getServerSnapshot(): boolean {
  return false;
}

function dismissBar(): void {
  sessionStorage.setItem(STORAGE_KEY, 'dismissed');
  cached = true;
  for (const listener of listeners) listener();
}

/**
 * Announcement bar.
 *
 * Rotates the shipping and returns promises that do the most to convert a
 * first-time visitor in this category.
 *
 * Not an `aria-live` region: a bar that re-announced itself every five seconds
 * would make a screen reader unusable. Every message stays reachable because
 * each one is a real link.
 */
export function AnnouncementBar() {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (dismissed || announcements.length < 2) return;

    const timer = setInterval(
      () => setIndex((value) => (value + 1) % announcements.length),
      ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [dismissed]);

  if (dismissed) return null;

  const current = announcements[index] ?? announcements[0];
  if (!current) return null;

  return (
    <div className="relative bg-ink-900 text-white">
      <div className="mx-auto flex min-h-11 max-w-(--container-shell) items-center justify-center gap-3 px-12 py-2.5 sm:px-14">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="text-center text-xs font-medium tracking-wide sm:text-body-sm"
          >
            {current.text}
            {current.href ? (
              <>
                {' '}
                <Link
                  href={current.href}
                  className="underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white"
                >
                  {current.linkLabel ?? 'Learn more'}
                </Link>
              </>
            ) : null}
          </motion.p>
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={dismissBar}
        aria-label="Dismiss announcement"
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
