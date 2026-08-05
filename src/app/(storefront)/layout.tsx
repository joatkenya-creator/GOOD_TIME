import { Suspense } from 'react';

import { WishlistSync } from '@/components/account/wishlist-sync';
import { AnalyticsTracker } from '@/components/analytics/tracker';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { ConsentBanner } from '@/components/marketing/consent-banner';
import { MarketingTags } from '@/components/marketing/tag-manager';
import { LEGAL_SLUGS } from '@/features/legal/documents';
import { getSessionUser } from '@/server/auth/session';
import { listPageSlugs } from '@/services/blog.service';
import { getCartCount } from '@/services/cart.service';
import { partitioned } from '@/services/marketing/integrations';

/**
 * Storefront shell.
 *
 * A route group rather than the root layout, because the `(auth)` pages
 * deliberately render without navigation — putting the header in the root layout
 * would drag it onto the sign-in screen and undo that decision.
 *
 * Route groups do not affect URLs: pages in here keep their normal paths.
 */
export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  // Read here rather than inside `Header`, so the header stays presentational and
  // the bag badge is still server-rendered with the right number.
  const user = await getSessionUser();
  const cartCount = await getCartCount(user?.id);

  /*
   * The tag split happens on the server.
   *
   * A tag that requires consent is never even *described* to the browser until
   * consent exists — there is no script element to accidentally execute, and a
   * visitor who declined is never told which trackers the shop would have run.
   */
  const tags = await partitioned();

  /*
   * Which `/pages/*` links the footer may render.
   *
   * The legal documents live in code; everything else is a published `Page`.
   * The footer drops links to anything absent rather than advertising a policy
   * page that 404s — see its header.
   */
  const publishedPages = await listPageSlugs();
  const availablePages = [...LEGAL_SLUGS, ...publishedPages.map(({ slug }) => slug)];

  return (
    <div className="flex min-h-dvh flex-col">
      <Header cartCount={cartCount} availablePages={availablePages} />

      {/* Signed-in only: a guest's list lives in `localStorage` and is already
          the whole truth, so there is nothing to merge. */}
      {user ? <WishlistSync /> : null}
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer availablePages={availablePages} />

      {/*
        `useSearchParams` inside the tracker opts its subtree into client-side
        rendering; the Suspense boundary stops that deopting the whole layout.
      */}
      <Suspense fallback={null}>
        <AnalyticsTracker />
      </Suspense>

      <MarketingTags
        immediate={tags.immediate.map((tag) => ({
          provider: tag.provider,
          publicId: tag.publicId,
          config: tag.config,
        }))}
        onConsent={tags.onConsent.map((tag) => ({
          provider: tag.provider,
          publicId: tag.publicId,
          config: tag.config,
        }))}
      />

      {/* Only shown when a tag actually needs consent — a cookie notice on a
          site that sets no tracking cookies trains people to dismiss notices. */}
      <ConsentBanner needed={tags.onConsent.length > 0} />
    </div>
  );
}
