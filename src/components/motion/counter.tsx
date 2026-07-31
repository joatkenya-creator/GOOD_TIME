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

  /**
   * Starts at the final value, not zero.
   *
   * The initial state is what the server renders, and a trust statistic that
   * reads "0+ orders shipped" until JavaScript hydrates is worse than showing no
   * statistic at all — it actively says the opposite of what it means. Verified
   * in Chromium: the hero stat row rendered "0+" and "3%".
   */
  const [animated, setAnimated] = useState(to);

  /** Null until the first effect: records whether this was visible on arrival. */
  const wasVisibleOnMount = useRef<boolean | null>(null);

  useEffect(() => {
    if (wasVisibleOnMount.current === null) wasVisibleOnMount.current = inView;

    // Already on screen when the page loaded — it is not a scroll reveal, so
    // show the number rather than counting up from zero under the visitor.
    if (wasVisibleOnMount.current) return;
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
