import type { Metadata } from 'next';

import { HistoryView } from '@/components/account/history-view';
import { ProductRail } from '@/components/account/product-rail';
import { requireUser } from '@/server/auth/session';
import { getRecentlyViewed, recommendedForCustomer } from '@/services/recommendation.service';

export const metadata: Metadata = { title: 'Recently viewed' };

/**
 * Browsing history.
 *
 * Presented as something the customer controls rather than something we keep on
 * them — individual removal and a clear-all, both prominent. On a store selling
 * adult products, "delete this from my history" is a feature people look for.
 */
export default async function RecentlyViewedPage() {
  const user = await requireUser();

  const [history, recommendations] = await Promise.all([
    getRecentlyViewed(user.id, 36),
    recommendedForCustomer(user.id, 8),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Recently viewed</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Only you can see this. Remove anything you would rather not keep.
        </p>
      </header>

      <HistoryView entries={history} />

      {recommendations.items.length > 0 ? (
        <ProductRail title={recommendations.basis} products={recommendations.items} />
      ) : null}
    </div>
  );
}
