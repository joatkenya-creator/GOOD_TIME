import { CreditCard, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Payment methods' };

/**
 * Saved cards.
 *
 * **No card data is stored, and none ever may be.** Each row is a Stripe
 * PaymentMethod reference plus the display fragments Stripe itself returns —
 * enough to render "Visa ending 4242" and nothing more. Storing a card number,
 * even encrypted, moves this store out of PCI SAQ-A into a scope needing an
 * annual audit.
 *
 * Saving a card at checkout needs Stripe SetupIntents, which are not wired up
 * yet; the schema and this page are ready for them.
 */
export default async function PaymentMethodsPage() {
  const user = await requireUser();

  const methods = await prisma.savedPaymentMethod.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Payment methods</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Cards you have saved for faster checkout.
        </p>
      </header>

      {methods.length === 0 ? (
        <EmptyState
          icon={<CreditCard aria-hidden="true" className="size-8" />}
          title="No saved cards"
          description="You can save a card during checkout once card storage is switched on. Until then, every checkout asks for it."
          action={
            <Button asChild variant="secondary">
              <Link href={ROUTES.shop}>Continue shopping</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {methods.map((method) => (
            <li key={method.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-body-sm font-medium text-foreground">
                  {method.brand ? method.brand.toUpperCase() : 'Card'} ending {method.last4}
                </p>
                {method.isDefault ? <Badge variant="success">Default</Badge> : null}
              </div>
              <p className="mt-1 text-body-xs text-foreground-subtle">
                Expires {String(method.expMonth).padStart(2, '0')}/{method.expYear}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-border bg-surface-muted p-5">
        <h2 className="flex items-center gap-2 text-body font-semibold text-foreground">
          <ShieldCheck aria-hidden="true" className="size-4 text-(--color-success)" />
          How your card is handled
        </h2>
        <ul className="mt-2 space-y-1 text-body-sm text-foreground-muted">
          <li>Card numbers go straight to Stripe and never reach our servers.</li>
          <li>We keep only a reference token, the brand, the last four digits and the expiry.</li>
          <li>Your statement shows a neutral descriptor, never a product name.</li>
        </ul>
      </section>
    </div>
  );
}
