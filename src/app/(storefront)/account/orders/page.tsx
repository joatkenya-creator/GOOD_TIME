import { Package } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { OrderSummaryCard } from '@/components/account/order-summary-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/server/auth/session';
import { cn } from '@/utils/cn';

export const metadata: Metadata = { title: 'Orders' };

/**
 * Order history.
 *
 * Filtering is a set of links rather than a client-side control: each filter is a
 * distinct URL, so it can be linked to, opened in a tab, and read by a crawler
 * that will never see it anyway. No JavaScript involved.
 */
const FILTERS = [
  { key: 'all', label: 'All', statuses: null },
  {
    key: 'open',
    label: 'In progress',
    statuses: ['PENDING', 'PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED'] as const,
  },
  { key: 'delivered', label: 'Delivered', statuses: ['DELIVERED'] as const },
  {
    key: 'cancelled',
    label: 'Cancelled & refunded',
    statuses: ['CANCELLED', 'REFUNDED', 'RETURNED'] as const,
  },
];

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { filter = 'all' } = await searchParams;

  const active = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0]!;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: {
        userId: user.id,
        ...(active.statuses ? { status: { in: [...active.statuses] } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: true, shipments: { take: 1, orderBy: { createdAt: 'desc' } } },
    }),
    prisma.order.count({ where: { userId: user.id } }),
  ]);

  if (total === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-h2 font-bold text-foreground">Orders</h1>
        <EmptyState
          icon={<Package aria-hidden="true" className="size-8" />}
          title="No orders yet"
          description="When you order something it will show up here, with tracking and an invoice."
          action={
            <Button asChild>
              <Link href={ROUTES.shop}>Start shopping</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Orders</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          {total} {total === 1 ? 'order' : 'orders'} placed with us.
        </p>
      </header>

      <nav aria-label="Filter orders">
        <ul className="flex [scrollbar-width:none] gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((entry) => (
            <li key={entry.key} className="shrink-0">
              <Link
                href={
                  entry.key === 'all'
                    ? ROUTES.account.orders
                    : `${ROUTES.account.orders}?filter=${entry.key}`
                }
                aria-current={active.key === entry.key ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-full border px-4 text-body-sm whitespace-nowrap transition-colors',
                  active.key === entry.key
                    ? 'bg-accent-subtle border-accent font-medium text-accent-text'
                    : 'border-border text-foreground-muted hover:border-foreground-subtle',
                )}
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-body-sm text-foreground-muted">
          No orders match that filter.
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderSummaryCard order={order} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
