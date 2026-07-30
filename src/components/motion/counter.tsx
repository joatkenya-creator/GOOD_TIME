'use client';

import { animate, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

export interface CounterProps {
  to: number;
  /** Rendered after the number — "+", "k", "%". */
  suffix?: string;
  prefix?: string;
  durationSeconds?: number;
  className?: string;
}

/**
 * Animated counter for trust statistics.
 *
 * Counts only when scrolled into view, and only once. The element carries the
 * final value in `aria-label` so assistive technology reads "50,000 orders"
 * instead of narrating every intermediate number.
 *
 * The reduced-motion case is derived during render rather than pushed through
 * state in an effect — there is nothing to synchronise, the answer is simply
 * "show the final value".
 */
export function Counter({
  to,
  suffix = '',
  prefix = '',
  durationSeconds = 1.6,
  className,
}: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const reduceMotion = useReducedMotion();
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;

    // `onUpdate` is a callback from framer's animation loop, not a synchronous
    // setState in the effect body.
    const controls = animate(0, to, {
      duration: durationSeconds,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (latest) => setAnimated(Math.round(latest)),
    });

    return () => controls.stop();
  }, [inView, to, durationSeconds, reduceMotion]);

  const value = reduceMotion ? to : animated;
  const formatted = `${prefix}${value.toLocaleString('en-US')}${suffix}`;
  const final = `${prefix}${to.toLocaleString('en-US')}${suffix}`;

  return (
    <span ref={ref} className={className} aria-label={final}>
      <span aria-hidden="true">{formatted}</span>
    </span>
  );
}
