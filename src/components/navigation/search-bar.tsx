'use client';

import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/utils/cn';

export interface SearchBarProps {
  className?: string;
  /** Renders a larger field, for the mobile drawer. */
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}

/** Placeholder suggestions until the search service exists in a later phase. */
const SUGGESTIONS = [
  'Silk massage oil',
  'Warming gel',
  'Couples gift set',
  'Body-safe silicone',
  'Bath soak',
];

/**
 * Storefront search.
 *
 * Implemented as a real `role="search"` form with a submit, so pressing Enter
 * navigates even before any JavaScript-driven suggestion layer exists.
 *
 * The suggestion list follows the ARIA combobox pattern: `aria-expanded`,
 * `aria-controls` and `aria-activedescendant` are wired so arrow keys move a
 * visible highlight that a screen reader also announces.
 */
export function SearchBar({ className, size = 'md', autoFocus = false }: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const debounced = useDebouncedValue(query, 200);
  const matches = debounced.trim()
    ? SUGGESTIONS.filter((entry) => entry.toLowerCase().includes(debounced.toLowerCase()))
    : [];

  /**
   * The highlighted suggestion is stored with the query it belongs to, so a new
   * query derives back to "nothing highlighted" without an effect resetting it.
   * Otherwise the highlight briefly points at the wrong row after each keystroke.
   */
  const [highlight, setHighlight] = useState({ query: '', index: -1 });
  const activeIndex = highlight.query === debounced ? highlight.index : -1;
  const setActiveIndex = (next: number) => setHighlight({ query: debounced, index: next });

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function submit(value: string) {
    const term = value.trim();
    if (!term) return;
    setOpen(false);
    router.push(`${ROUTES.search}?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!matches.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((activeIndex + 1) % matches.length);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((activeIndex - 1 + matches.length) % matches.length);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(activeIndex >= 0 ? (matches[activeIndex] ?? query) : query);
        }}
      >
        <label htmlFor="site-search" className="sr-only">
          Search products
        </label>

        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground-subtle"
        />

        <input
          id="site-search"
          type="search"
          role="combobox"
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search products, brands, guides…"
          aria-expanded={open && matches.length > 0}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
          className={cn(
            'w-full rounded-full border border-border bg-surface-muted pr-11 pl-11 text-body-sm text-foreground',
            'placeholder:text-foreground-subtle',
            'transition-[border-color,background-color,box-shadow] duration-(--duration-fast)',
            'focus:border-accent focus:bg-surface focus:ring-4 focus:ring-brand-100 focus:outline-none',
            '[&::-webkit-search-cancel-button]:hidden',
            size === 'lg' ? 'h-13' : 'h-11',
          )}
        />

        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1.5 text-foreground-subtle transition-colors hover:bg-ink-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </form>

      {open && matches.length > 0 ? (
        <ul
          id="search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute top-[calc(100%+0.5rem)] z-(--z-drawer) w-full overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          {matches.map((entry, index) => (
            <li key={entry}>
              <button
                type="button"
                id={`search-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => submit(entry)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body-sm',
                  index === activeIndex
                    ? 'bg-surface-muted text-foreground'
                    : 'text-foreground-muted',
                )}
              >
                <Search aria-hidden="true" className="size-3.5 text-foreground-subtle" />
                {entry}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
