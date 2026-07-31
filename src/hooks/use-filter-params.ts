'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Filter state, stored in the URL.
 *
 * The URL is the single source of truth rather than component state, which buys
 * three things that matter commercially: a filtered listing is shareable, the
 * back button behaves, and the server can render the filtered page directly
 * instead of shipping an empty shell that fetches on mount.
 *
 * `scroll: false` on every update — re-filtering should not throw the customer
 * back to the top of the page. Changes run inside a transition so the current
 * results stay interactive while the new ones stream in.
 */
export function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const commit = useCallback(
    (next: URLSearchParams) => {
      // Any filter change invalidates the page cursor. Leaving it behind is how
      // you end up on page 4 of a 2-page result set.
      next.delete('page');

      const query = next.toString();
      startTransition(() => {
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  /** Current values for a CSV parameter. */
  const values = useCallback(
    (key: string): string[] => {
      const raw = searchParams.get(key);
      return raw ? raw.split(',').filter(Boolean) : [];
    },
    [searchParams],
  );

  /** Adds or removes one value within a multi-select parameter. */
  const toggleValue = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      const current = values(key);
      const updated = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];

      if (updated.length) next.set(key, updated.join(','));
      else next.delete(key);

      commit(next);
    },
    [commit, searchParams, values],
  );

  /** Sets or clears a single-value parameter. */
  const setValue = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      commit(next);
    },
    [commit, searchParams],
  );

  /** Clears every filter but keeps sort and view, which are preferences. */
  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    for (const key of ['sort', 'view'] as const) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    commit(next);
  }, [commit, searchParams]);

  const activeFilterCount = [...searchParams.entries()].filter(
    ([key]) => !['sort', 'view', 'page', 'q'].includes(key),
  ).length;

  return {
    searchParams,
    values,
    toggleValue,
    setValue,
    clearFilters,
    activeFilterCount,
    isPending,
    has: useCallback((key: string, value: string) => values(key).includes(value), [values]),
    get: useCallback((key: string) => searchParams.get(key), [searchParams]),
  };
}
