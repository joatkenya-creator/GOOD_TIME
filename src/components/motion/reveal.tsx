'use client';

import { motion, useReducedMotion } from 'framer-motion';

export interface RevealProps {
  children: React.ReactNode;
  /** Stagger position within a group, in seconds per index. */
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
  /**
   * Renders the content immediately, with no entrance animation.
   *
   * **Required for anything above the fold.** A scroll reveal starts at
   * `opacity: 0`, and that inline style is present in the server-rendered HTML —
   * so the element is invisible until JavaScript hydrates. On the hero that
   * means the `<h1>`, the description and the primary call to action paint blank
   * on first render, which wrecks Largest Contentful Paint and leaves the page
   * empty entirely if the bundle fails to load.
   *
   * Verified in Chromium at 1440px: the hero was blank above the fold.
   */
  immediate?: boolean;
}

const OFFSETS = {
  up: { y: 24, x: 0 },
  down: { y: -24, x: 0 },
  left: { y: 0, x: 24 },
  right: { y: 0, x: -24 },
  none: { y: 0, x: 0 },
} as const;

/**
 * Scroll reveal.
 *
 * A client boundary that wraps server-rendered children — the content inside is
 * still rendered on the server and streamed as HTML, so this costs a wrapper's
 * worth of JavaScript rather than pulling a whole section onto the client.
 *
 * `once: true` means content animates in a single time; re-animating on every
 * scroll-by is the fastest way to make a premium site feel like a demo.
 *
 * Honours `prefers-reduced-motion` by rendering the final state immediately.
 */
export function Reveal({
  children,
  delay = 0,
  direction = 'up',
  className,
  as = 'div',
  immediate = false,
}: RevealProps) {
  const reduceMotion = useReducedMotion();
  const offset = OFFSETS[direction];
  const Component = motion[as];

  // Above the fold, or the visitor asked for less motion: render the final state
  // as plain markup so it is visible in the server HTML.
  if (reduceMotion || immediate) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }

  return (
    <Component
      className={className}
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </Component>
  );
}
