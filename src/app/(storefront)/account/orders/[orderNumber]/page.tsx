import { ArrowLeft, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrderActions } from '@/components/account/order-actions';
import { ReturnRequestForm } from '@/components/account/return-request-form';
import { OrderDetail } from '@/components/order/order-detail';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/server/auth/session';
import { getOrderById } from '@/services/order.service';
import { returnEligibility, returnsForOrder } from '@/services/return.service';

export const metadata: Metadata = { title: 'Order' };

/**
 * One order, in the account.
 *
 * Reuses `OrderDetail` — the same component the post-checkout confirmation and
 * the guest lookup render — so all three describe an order identically. What is
 * added here is what only an account holder can do: reorder, request a return,
 * download an invoice.
 */
export default async function AccountOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const user = await requireUser();
  const { orderNumber } = await params;

  // Scoped to the session's user id, never to a parameter. Reading someone
  // else's order must be impossible, not merely unlikely.
  const owned = await prisma.order.findFirst({
    where: { orderNumber, userId: user.id },
    select: { id: true },
  });

  if (!owned) notFound();

  const order = await getOrderById(owned.id);
  if (!order) notFound();

  const [existingReturns, eligibility] = await Promise.all([
    returnsForOrder(order.id),
    Promise.resolve(returnEligibility(order)),
  ]);

  // What is left to return, after everything already claimed on an open or
  // completed request.
  const claimed = new Map<string, number>();
  for (const request of existingReturns) {
    if (request.status === 'CANCELLED' || request.status === 'REJECTED') continue;
    for (const item of request.items) {
      claimed.set(item.orderItemId, (claimed.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }

  const returnableItems = order.items.map((item) => ({
    id: item.id,
    productName: item.productName,
    variantName: item.variantName,
    quantity: item.quantity,
    returnable: Math.max(0, item.quantity - (claimed.get(item.id) ?? 0)),
    unitPriceCents: item.unitPriceCents,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={ROUTES.account.orders}
          className="inline-flex min-h-11 items-center gap-1.5 text-body-sm font-medium text-accent-text hover:text-accent-hover"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          All orders
        </Link>
      </div>

      <OrderDetail order={order} />

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-body-lg font-semibold text-foreground">What would you like to do?</h2>

        <div className="mt-4 flex flex-wrap gap-3">
          <OrderActions orderId={order.id} />

          {eligibility.eligible ? (
            <ReturnRequestForm
              orderId={order.id}
              orderNumber={order.orderNumber}
              items={returnableItems}
            />
          ) : null}

          <Button asChild variant="ghost">
            <Link
              href={`/order/${order.orderNumber}/receipt?email=${encodeURIComponent(order.email)}`}
            >
              <Printer aria-hidden="true" className="size-4" />
              Invoice
            </Link>
          </Button>
        </div>

        {!eligibility.eligible && eligibility.reason ? (
          <p className="mt-4 text-body-sm text-foreground-subtle">{eligibility.reason}</p>
        ) : eligibility.deadline ? (
          <p className="mt-4 text-body-sm text-foreground-subtle">
            You can return this until{' '}
            {eligibility.deadline.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            . For hygiene reasons we can only accept unopened items.
          </p>
        ) : null}
      </section>

      {existingReturns.length > 0 ? (
        <Alert variant="info" title="This order has a return">
          <Link href="/account/returns" className="font-medium underline underline-offset-4">
            Track it on the returns page
          </Link>
          .
        </Alert>
      ) : null}
    </div>
  );
}
