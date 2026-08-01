'use client';

import { useEffect, useRef } from 'react';

import { wishlistStore } from '@/features/catalog/local-list';
import { mergeWishlistAction } from '@/server/actions/wishlist';

/**
 * Folds a guest's local wishlist into their account, once per browser session.
 *
 * The server cannot read `localStorage`, so the merge has to be triggered from
 * the client — this is the bridge. It runs once, guarded by a `sessionStorage`
 * flag, because the union is idempotent but the round trip is not free.
 *
 * Rendered only for signed-in visitors; for a guest there is nothing to merge
 * and the local list is already the whole truth.
 */
export function WishlistSync() {
  // A ref, not state: this must run once per mount and must never re-render.
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const FLAG = 'gt.wishlist-synced';

    try {
      if (sessionStorage.getItem(FLAG)) return;
      sessionStorage.setItem(FLAG, '1');
    } catch {
      // Private mode with storage disabled. Merging every navigation is worse
      // than not merging, so stop here.
      return;
    }

    const local = wishlistStore.getSnapshot();

    void mergeWishlistAction([...local]).then((result) => {
      // Write the union back so the heart icons match the account immediately,
      // without waiting for a page that reads the server copy.
      if (result.ok) wishlistStore.replace(result.productIds);
    });
  }, []);

  return null;
}
