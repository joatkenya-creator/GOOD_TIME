/**
 * Checkout shell.
 *
 * Its own route group because checkout deliberately renders without the header,
 * mega menu and footer. Every navigation link on this page is a route out of a
 * funnel someone is already in — removing them is one of the few checkout
 * changes with a consistently measurable effect on completion.
 *
 * Route groups do not affect URLs: `/checkout` is still `/checkout`.
 */
export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="min-h-dvh">
      {children}
    </main>
  );
}
