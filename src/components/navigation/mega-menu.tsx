'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Badge } from '@/components/ui/badge';
import { primaryNav } from '@/config/navigation';
import { cn } from '@/utils/cn';

/** Grace period before a menu closes, so a diagonal mouse path does not lose it. */
const CLOSE_DELAY_MS = 120;

/**
 * Desktop mega menu.
 *
 * Opens on hover *and* on click/Enter, because hover alone excludes keyboard and
 * touch users. Escape closes and returns focus to the trigger; Tab out of the
 * panel closes it, so the menu never traps or lingers.
 *
 * The close delay matters more than it looks: without it, moving the pointer
 * diagonally from the trigger to the panel's far column closes the menu
 * mid-journey, which is the single most common mega-menu defect.
 */
export function MegaMenu() {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  function open(label: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenLabel(label);
  }

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenLabel(null), CLOSE_DELAY_MS);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenLabel(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="hidden lg:block"
      onMouseLeave={scheduleClose}
      onBlur={(event) => {
        if (!navRef.current?.contains(event.relatedTarget as Node)) setOpenLabel(null);
      }}
    >
      <ul className="flex items-center gap-1">
        {primaryNav.map((item) => {
          const hasPanel = Boolean(item.columns?.length);
          const isOpen = openLabel === item.label;

          return (
            <li
              key={item.label}
              onMouseEnter={() => (hasPanel ? open(item.label) : scheduleClose())}
            >
              <Link
                href={item.href}
                aria-expanded={hasPanel ? isOpen : undefined}
                aria-haspopup={hasPanel ? 'true' : undefined}
                onFocus={() => (hasPanel ? open(item.label) : setOpenLabel(null))}
                onClick={() => setOpenLabel(null)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3.5 py-2 text-body-sm font-medium',
                  'transition-colors duration-(--duration-fast) ease-(--ease-brand)',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
                  isOpen ? 'text-accent-text' : 'text-foreground hover:text-accent-text',
                )}
              >
                {item.label}
                {item.tag ? (
                  <Badge variant="accent" size="sm">
                    {item.tag}
                  </Badge>
                ) : null}
                {hasPanel ? (
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 text-foreground-subtle transition-transform duration-(--duration-base)',
                      isOpen && 'rotate-180',
                    )}
                  />
                ) : null}
              </Link>

              <AnimatePresence>
                {hasPanel && isOpen ? (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                    onMouseEnter={() => open(item.label)}
                    className="absolute inset-x-0 top-full z-(--z-header) border-t border-border bg-surface shadow-lg"
                  >
                    <div className="mx-auto grid max-w-(--container-shell) gap-10 px-(--spacing-gutter) py-10 sm:px-8 lg:grid-cols-[1fr_auto]">
                      <div
                        className="grid gap-10"
                        style={{
                          gridTemplateColumns: `repeat(${item.columns?.length ?? 1}, minmax(0, 1fr))`,
                        }}
                      >
                        {item.columns?.map((column) => (
                          <div key={column.title}>
                            <p className="text-eyebrow text-foreground-subtle uppercase">
                              {column.title}
                            </p>
                            <ul className="mt-4 space-y-1">
                              {column.items.map((entry) => (
                                <li key={entry.href}>
                                  <Link
                                    href={entry.href}
                                    onClick={() => setOpenLabel(null)}
                                    className="flex items-center gap-2 rounded-md py-1.5 text-body-sm text-foreground-muted transition-colors hover:text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                                  >
                                    {entry.label}
                                    {entry.tag ? (
                                      <Badge variant="danger" size="sm">
                                        {entry.tag}
                                      </Badge>
                                    ) : null}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>

                      {item.feature ? (
                        <Link
                          href={item.feature.href}
                          onClick={() => setOpenLabel(null)}
                          className="group/feature relative flex w-80 flex-col overflow-hidden rounded-2xl bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                        >
                          <MediaPlaceholder
                            seed={item.feature.imageSeed}
                            ratio="landscape"
                            tone="brand"
                            className="transition-transform duration-700 ease-(--ease-brand) group-hover/feature:scale-105"
                          />
                          <div className="p-5">
                            <p className="text-eyebrow text-accent-text uppercase">
                              {item.feature.eyebrow}
                            </p>
                            <p className="mt-2 font-display text-lg tracking-tight text-foreground">
                              {item.feature.title}
                            </p>
                            <p className="mt-1.5 text-body-sm leading-relaxed text-foreground-muted">
                              {item.feature.description}
                            </p>
                            <span className="mt-3 inline-flex items-center gap-1.5 text-body-sm font-medium text-accent-text">
                              {item.feature.cta}
                              <ArrowRight
                                aria-hidden="true"
                                className="size-4 transition-transform duration-(--duration-base) group-hover/feature:translate-x-1"
                              />
                            </span>
                          </div>
                        </Link>
                      ) : null}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
