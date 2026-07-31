'use client';

import { useSyncExternalStore } from 'react';

/**
 * The bag badge count, shared across component trees.
 *
 * The badge lives in the header; the buttons that change it live on product
 * pages and in the cart. They are separate trees that must never disagree, which
 * is the same problem `use-product-lists` solves — and the same solution.
 *
 * ## Why not just revalidate
 *
 * The first version called `revalidatePath('/', 'layout')` after every cart
 * mutation, so the server-rendered header would pick up the new count. That
 * invalidates the router cache for the *entire site*: one "add to bag" made the
 * browser refetch every prefetched route it held, and the round trip went from
 * hundreds of milliseconds to twelve seconds. The badge still lagged, because
 * the re-render lands after the action resolves.
 *
 * So the count is client state, seeded from the server on first paint. The
 * server value is still authoritative on every full page load; this only carries
 * it between them.
 */

let count: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): number | null => count;

/** Null on the server, so the server-rendered `initialCount` wins the first paint. */
const getServerSnapshot = (): number | null => null;

/** Called by any action that changes what is in the bag. */
export function setCartCount(next: number): void {
  if (count === next) return;
  count = next;
  emit();
}

/**
 * Current count.
 *
 * `initialCount` comes from the server render and is used until a mutation
 * publishes a newer one — so the badge is correct in the first HTML, never
 * flashes, and never needs a round trip to be right.
 */
export function useCartCount(initialCount: number): number {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return live ?? initialCount;
}
