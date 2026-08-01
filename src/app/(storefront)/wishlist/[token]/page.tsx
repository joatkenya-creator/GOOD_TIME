import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Container } from '@/components/layout/container';
import { ProductGrid } from '@/components/catalog/product-grid';
import { getSharedWishlist } from '@/services/wishlist.service';

/**
 * A shared wishlist.
 *
 * Public to anyone holding the token and to nobody else. It shows no name, no
 * email and no order history — a share link gets forwarded, and what it reveals
 * should stop at "these are the things someone likes".
 *
 * `noindex` is not optional here: this store sells adult products, and a
 * crawlable page tying a person to a list of them is a genuine harm.
 */
export const metadata: Metadata = {
  title: 'A shared wishlist',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function SharedWishlistPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const wishlist = await getSharedWishlist(token).catch(() => null);
  if (!wishlist) notFound();

  return (
    <Container className="py-10 sm:py-16">
      <header className="text-center">
        <p className="text-eyebrow uppercase text-accent-text">Shared wishlist</p>
        <h1 className="mt-3 text-h2 font-bold text-foreground">{wishlist.name}</h1>
        <p className="mt-2 text-body-sm text-foreground-muted">
          {wishlist.items.length} {wishlist.items.length === 1 ? 'item' : 'items'} · shipped in
          plain, unbranded packaging
        </p>
      </header>

      <div className="mt-10">
        <ProductGrid products={wishlist.items} />
      </div>
    </Container>
  );
}
