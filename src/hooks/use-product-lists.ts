'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  COMPARE_LIMIT,
  compareStore,
  recentlyViewedStore,
  wishlistStore,
  type LocalListStore,
} from '@/features/catalog/local-list';

/**
 * React bindings for the browser-persisted product lists.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the header badge,
 * every card button and the compare bar are separate component trees reading the
 * same list, and they must never disagree.
 */
function useLocalList(store: LocalListStore) {
  const ids = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  return {
    ids,
    count: ids.length,
    has: useCallback((id: string) => ids.includes(id), [ids]),
    add: store.add,
    remove: store.remove,
    toggle: store.toggle,
    clear: store.clear,
  };
}

export function useWishlist() {
  return useLocalList(wishlistStore);
}

export function useRecentlyViewed() {
  const list = useLocalList(recentlyViewedStore);

  return {
    ...list,
    /** Excludes the product currently being viewed — it is not a suggestion. */
    othersThan: useCallback(
      (currentId: string) => list.ids.filter((id) => id !== currentId),
      [list.ids],
    ),
  };
}

export function useCompare() {
  const list = useLocalList(compareStore);

  return {
    ...list,
    limit: COMPARE_LIMIT,
    isFull: list.count >= COMPARE_LIMIT,
    /**
     * Adds unless the list is full. Returns why it failed so the caller can show a
     * toast rather than silently doing nothing.
     */
    tryAdd: useCallback(
      (id: string): { ok: true } | { ok: false; reason: 'full' | 'duplicate' } => {
        if (list.ids.includes(id)) return { ok: false, reason: 'duplicate' };
        if (list.ids.length >= COMPARE_LIMIT) return { ok: false, reason: 'full' };
        compareStore.add(id);
        return { ok: true };
      },
      [list.ids],
    ),
  };
}
