'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

export interface CarouselProps {
  children: React.ReactNode;
  /** Accessible name for the scroll region, e.g. "Best sellers". */
  label: string;
  className?: string;
  railClassName?: string;
}

/**
 * Horizontal carousel built on CSS scroll-snap.
 *
 * The browser does the scrolling, the momentum and the snapping; we add arrow
 * buttons for pointer users. That is a few dozen lines instead of a carousel
 * library, and it degrades to a normal scroll region if JavaScript never loads.
 *
 * The rail is a focusable `region` with `tabindex=0` so keyboard users can pan
 * it with arrow keys — a scrollable container that cannot receive focus is a
 * WCAG 2.1 failure.
 */
export function Carousel({ children, label, className, railClassName }: CarouselProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateBounds = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;

    setAtStart(rail.scrollLeft <= 1);
    // 1px of slack absorbs sub-pixel rounding at fractional zoom levels.
    setAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [updateBounds]);

  function scrollBy(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    // Page by ~90% of the viewport so the next card peeks in, signalling more.
    rail.scrollBy({ left: direction * rail.clientWidth * 0.9, behavior: 'smooth' });
  }

  return (
    <div className={cn('relative', className)}>
      {/*
       * `overflow-hidden` on this wrapper, in addition to `overflow-x-auto` on the
       * rail itself.
       *
       * That looks redundant and is not. Measured in Chromium at 360px: the rail
       * was a correct scroll container (320px box, 2020px of content) and yet its
       * children still contributed to `documentElement.scrollWidth`, giving the
       * whole page 1437px of horizontal scroll on mobile. `overflow: hidden` on
       * the rail did not stop it; clipping one level up does.
       *
       * The rail keeps its own `overflow-x-auto`, so it still scrolls and snaps.
       */}
      <div className="overflow-hidden [contain:paint]">
        <div
          ref={railRef}
          role="region"
          aria-label={label}
          tabIndex={0}
          onScroll={updateBounds}
          className={cn(
            /*
             * Scroll behaviour is expressed as Tailwind utilities rather than the
             * custom `.snap-rail` class it used to use. The custom class declared
             * the same `overflow-x: auto` but did not clip: the parent still
             * reported a 1777px `scrollWidth` inside a 320px box, which leaked all
             * the way up and gave the whole page a horizontal scrollbar on mobile.
             * Verified in Chromium at 360px.
             *
             * `min-w-0` is the load-bearing part — without it a flex/grid child
             * takes `min-width: auto`, refuses to shrink below its content, and
             * `overflow-x-auto` never engages.
             */
            'flex min-w-0 snap-x snap-mandatory gap-5 overflow-x-auto overscroll-x-contain scroll-smooth pb-2',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            '[&>*]:shrink-0 [&>*]:snap-start',
            // Inset focus ring: an offset ring would be clipped by the wrapper.
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--color-ring)',
            railClassName,
          )}
        >
          {children}
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <ArrowButton direction="left" disabled={atStart} onClick={() => scrollBy(-1)} />
        <ArrowButton direction="right" disabled={atEnd} onClick={() => scrollBy(1)} />
      </div>
    </div>
  );
}

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      className={cn(
        'flex size-11 items-center justify-center rounded-full border border-border bg-surface text-foreground',
        'transition-all duration-(--duration-fast) ease-(--ease-brand)',
        'hover:border-foreground hover:bg-foreground hover:text-white',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
}
