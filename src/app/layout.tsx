import type { Metadata, Viewport } from 'next';

import '@/styles/globals.css';

import { Analytics } from '@/components/common/analytics';
import { siteConfig } from '@/config/site';
import { fontVariables } from '@/lib/performance/fonts';
import { buildRootMetadata } from '@/lib/seo/metadata';
import { Providers } from '@/providers';

/**
 * Root layout.
 *
 * The only layout that renders `<html>`. Everything global lives here: fonts,
 * the provider tree, analytics, and the skip link. Route groups add their own
 * chrome on top.
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
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="min-h-dvh bg-background antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <Providers>{children}</Providers>

        <Analytics />
      </body>
    </html>
  );
}
