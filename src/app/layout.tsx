import type { Metadata, Viewport } from 'next';

import '@/styles/globals.css';

import { AgeGate } from '@/components/common/age-gate';
import { Analytics } from '@/components/common/analytics';
import { siteConfig } from '@/config/site';
import { AGE_GATE_INLINE_SCRIPT } from '@/lib/age-gate';
import { fontVariables } from '@/lib/performance/fonts';
import { buildRootMetadata } from '@/lib/seo/metadata';
import { Providers } from '@/providers';

/**
 * Root layout.
 *
 * The only layout that renders `<html>`. Everything global lives here: fonts,
 * the provider tree, analytics, the skip link and the age gate. Route groups add
 * their own chrome on top.
 */
export const metadata: Metadata = buildRootMetadata();

export const viewport: Viewport = {
  themeColor: siteConfig.themeColor,
  width: 'device-width',
  initialScale: 1,
  // Do not cap zoom — pinch-to-zoom is an accessibility requirement, not a bug.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-scroll-behavior` tells Next that the smooth scrolling in globals.css
    // is intentional, so it does not warn about hijacked route transitions.
    <html
      lang="en"
      className={fontVariables}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/*
         * Runs before first paint so a returning visitor never sees the age gate
         * flash. It only stamps an attribute on <html>; the CSS rule in
         * globals.css does the hiding. See src/lib/age-gate.ts for why this is
         * an inline script rather than a server-side cookie read.
         */}
        <script dangerouslySetInnerHTML={{ __html: AGE_GATE_INLINE_SCRIPT }} />
      </head>

      <body className="min-h-dvh bg-background antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <Providers>{children}</Providers>

        {/* Outside <Providers>: the gate must not depend on session or query state. */}
        <AgeGate />

        <Analytics />
      </body>
    </html>
  );
}
