import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';

/**
 * Storefront shell.
 *
 * A route group rather than the root layout, because the `(auth)` pages
 * deliberately render without navigation — putting the header in the root layout
 * would drag it onto the sign-in screen and undo that decision.
 *
 * Route groups do not affect URLs: pages in here keep their normal paths.
 */
export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
