import { Package } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { requireUser } from '@/server/auth/session';
import { getOrdersForUser } from '@/services/order.service';
import { formatPrice } from '@/utils/format';

/**
 * Order history.
 *
 * `requireUser` redirects rather than throwing — this is a page, and an
 * unauthenticated visitor should land on sign-in, not on an error.
 */
export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TONE = {
  PENDING: 'warning',
  PAID: 'success',
  CONFIRMED: 'success',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'info',
  RETURNED: 'info',
} as const;

export default async function AccountOrdersPage() {
  const user = await requireUser();
  const orders = await getOrdersForUser(user.id, 50);

  if (orders.length === 0) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<Package aria-hidden="true" className="size-8" />}
          title="No orders yet"
          description="When you place an order it will show up here, with tracking."
          action={
            <Button asChild>
              <Link href={ROUTES.shop}>Start shopping</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <h1 className="text-h2 font-bold text-foreground">Your orders</h1>

      <ul className="mt-8 space-y-4">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/order/${order.orderNumber}`}
              className="block rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-body-sm font-semibold text-foreground">
                    {order.orderNumber}
                  </p>
                  <p className="text-body-xs text-foreground-subtle">
                    {(order.placedAt ?? order.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant={TONE[order.status]}>{order.status.toLowerCase()}</Badge>
                  <span className="text-body font-semibold tabular-nums text-foreground">
                    {formatPrice(order.totalCents)}
                  </span>
                </div>
              </div>

              <p className="mt-3 line-clamp-1 text-body-sm text-foreground-muted">
                {order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
