import type { Metadata } from 'next';

import { WishlistView } from '@/components/account/wishlist-view';
import { publicEnv } from '@/lib/env.public';
import { requireUser } from '@/server/auth/session';
import { getWishlist } from '@/services/wishlist.service';

export const metadata: Metadata = { title: 'Wishlist' };

export default async function WishlistPage() {
  const user = await requireUser();
  const wishlist = await getWishlist(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Wishlist</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Saved items follow you between devices while you are signed in.
        </p>
      </header>

      <WishlistView
        items={wishlist.items}
        shareToken={wishlist.shareToken}
        siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}
      />
    </div>
  );
}
