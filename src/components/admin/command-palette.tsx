'use client';

import { ArrowRight, CornerDownLeft, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ADMIN_ICONS } from '@/components/admin/admin-icons';
import type { ShellNavItem } from '@/components/admin/admin-shell';
import { cn } from '@/utils/cn';

interface SearchHit {
  id: string;
  type: 'product' | 'order' | 'customer';
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global search and command palette.
 *
 * Two things in one surface, deliberately: staff looking for order GT-100042
 * and staff wanting to reach Inventory both start by pressing ⌘K, and giving
 * them two shortcuts to remember means they remember neither.
 *
 * Navigation matches locally and instantly. Records are fetched, debounced,
 * and only once two characters have been typed — one character matches most of
 * the catalogue and produces a list nobody wants.
 */
export function AdminCommandPalette({
  open,
  onClose,
  navItems,
}: {
  open: boolean;
  onClose: () => void;
  navItems: ShellNavItem[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  /*
   * Opening resets by remounting, not by clearing state in an effect.
   *
   * The parent gives this component a `key` that changes each time it opens,
   * so every open starts from fresh state. Reopening onto a stale query and a
   * stale highlight is how someone presses Enter out of habit and navigates
   * somewhere they did not intend.
   */
  useEffect(() => {
    // Focus only. The input mounts with the dialog, so it waits a frame.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  const navMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return navItems.slice(0, 6);

    return navItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          (item.hint ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [navItems, query]);

  /*
   * Record search, debounced.
   *
   * The abort matters more than the delay: without it a fast typist has five
   * requests in flight and the slowest one wins, so the list settles on results
   * for a prefix they have already finished typing.
   */
  useEffect(() => {
    const needle = query.trim();
    // Below the threshold there is nothing to fetch and nothing to clear:
    // `visibleHits` below derives the empty list, so no state changes here.
    if (needle.length < 2) return;

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      // The spinner is raised inside the timeout, not before it. A fast typist
      // never sees it flash on and off between keystrokes, and it keeps the
      // effect body free of a synchronous state change during commit.
      setLoading(true);

      try {
        const response = await fetch(`/api/admin/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body: { ok: boolean; data: SearchHit[] } = await response.json();
        setHits(body.data ?? []);
      } catch {
        // An aborted request is the normal case, not an error worth surfacing.
        if (!controller.signal.aborted) setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  /*
   * Results are derived, not cleared.
   *
   * Deleting back to one character hides the hits by deriving an empty list
   * rather than by resetting state in an effect — which would be a second
   * render on every keystroke that crosses the threshold.
   */
  const searching = query.trim().length >= 2;

  const rows = useMemo(
    () => [
      ...navMatches.map((item) => ({ kind: 'nav' as const, item })),
      ...(searching ? hits : []).map((hit) => ({ kind: 'hit' as const, hit })),
    ],
    [navMatches, hits, searching],
  );

  // Clamped at read time rather than corrected in an effect: the highlight can
  // only ever point past the end for one render, and clamping here means that
  // render is already correct.
  const active = Math.min(cursor, Math.max(0, rows.length - 1));

  if (!open) return null;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((previous) => (previous + 1) % Math.max(1, rows.length));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((previous) => (previous - 1 + rows.length) % Math.max(1, rows.length));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[active];
      if (!row) return;
      go(row.kind === 'nav' ? row.item.href : row.hit.href);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[10vh]">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close search"
        tabIndex={-1}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            aria-label="Search products, orders, customers and admin pages"
            className="h-14 flex-1 bg-transparent text-body outline-none placeholder:text-foreground-subtle"
          />
          {searching && loading ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-foreground-subtle"
              aria-hidden="true"
            />
          ) : null}
        </div>

        <ul className="max-h-[55vh] overflow-y-auto p-2">
          {rows.length === 0 ? (
            <li className="px-3 py-8 text-center text-body-sm text-foreground-subtle">
              {query.trim().length < 2 ? 'Type to search.' : `Nothing matches “${query.trim()}”.`}
            </li>
          ) : null}

          {rows.map((row, index) => {
            const isActive = index === active;

            if (row.kind === 'nav') {
              const Icon = ADMIN_ICONS[row.item.icon];
              return (
                <li key={`nav-${row.item.href}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(row.item.href)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                      isActive ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium">
                        {row.item.label}
                      </span>
                      {row.item.hint ? (
                        <span className="text-body-xs block truncate text-foreground-subtle">
                          {row.item.hint}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? (
                      <CornerDownLeft
                        className="size-3.5 shrink-0 text-foreground-subtle"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </li>
              );
            }

            return (
              <li key={`hit-${row.hit.type}-${row.hit.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(row.hit.href)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                    isActive ? 'bg-surface-muted' : 'hover:bg-surface-muted',
                  )}
                >
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] tracking-wide text-foreground-subtle uppercase">
                    {row.hit.type}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium">{row.hit.title}</span>
                    <span className="text-body-xs block truncate text-foreground-subtle">
                      {row.hit.subtitle}
                    </span>
                  </span>
                  <ArrowRight
                    className="size-3.5 shrink-0 text-foreground-subtle"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="text-body-xs flex items-center gap-4 border-t border-border px-4 py-2 text-foreground-subtle">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
