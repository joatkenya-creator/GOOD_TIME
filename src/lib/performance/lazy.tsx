'use client';

import dynamic from 'next/dynamic';
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Code-splitting helpers.
 *
 * Anything heavy and below the fold — image galleries, review carousels, the
 * checkout's address autocomplete — should come through here rather than being
 * imported at the top of a page.
 */

interface LazyOptions {
  /** Rendered while the chunk downloads. Defaults to a skeleton block. */
  loading?: () => ReactNode;
  /** Set false for components that must render identically on the server. */
  ssr?: boolean;
}

/** Dynamically imports a client component with a skeleton fallback. */
export function lazyComponent<Props extends object>(
  loader: () => Promise<{ default: ComponentType<Props> }>,
  options: LazyOptions = {},
) {
  return dynamic(loader, {
    ssr: options.ssr ?? true,
    loading: options.loading ?? (() => <Skeleton className="h-40 w-full" />),
  });
}

/**
 * Reports when an element first enters the viewport (plus a generous root margin,
 * so the work starts before the user actually gets there).
 *
 * Used to defer non-critical fetches — "you may also like", recently viewed —
 * without shipping an intersection-observer library.
 */
export function useInViewOnce<T extends Element>(
  rootMargin = '200px',
): {
  ref: React.RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
