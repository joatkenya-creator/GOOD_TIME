import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { getSessionUser } from '@/server/auth/session';
import { getCartCount } from '@/services/cart.service';

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

  return (
    <div className="flex min-h-dvh flex-col">
      <Header cartCount={cartCount} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
