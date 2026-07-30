'use client';

import { useSyncExternalStore } from 'react';

/**
 * Reactive media query.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: it gives a correct
 * server snapshot, so hydration cannot flash the wrong layout.
 *
 * Prefer CSS for layout. Reach for this only when the *behaviour* differs — a
 * drawer on mobile versus a dropdown on desktop.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Server render assumes mobile — the smaller layout degrades more gracefully.
    () => false,
  );
}

/** Matches the Tailwind breakpoints so JS and CSS agree on where "desktop" starts. */
export const BREAKPOINTS = {
  sm: '(min-width: 40rem)',
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
} as const;

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
