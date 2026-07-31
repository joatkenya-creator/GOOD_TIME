import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Container } from '@/components/layout/container';
import { OrderDetail } from '@/components/order/order-detail';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/constants/routes';
import { getSessionUser } from '@/server/auth/session';
import { getOrderByNumber } from '@/services/order.service';

/**
 * Order confirmation and status.
 *
 * Reachable two ways: signed in, or with the order number *and* the email it was
 * placed with. Order numbers are sequential by design — readable down a phone
 * line — which makes them guessable, so the number alone is never enough.
 *
 * This is also where Stripe returns a customer after a 3DS redirect. The status
 * shown comes from the database, not from any query parameter, so a customer who
 * edits the URL sees the truth rather than a forged confirmation.
 */
export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string; new?: string }>;
}) {
  const { orderNumber } = await params;
  const query = await searchParams;

  const user = await getSessionUser();
  const email = query.email ?? user?.email;

  if (!email) {
    return (
      <Container className="max-w-lg py-16">
        <Alert variant="info" title="We need your email">
          To view this order, open the link in your confirmation email, or sign in with the account
          you used.
        </Alert>

        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link href={ROUTES.auth.signIn}>Sign in</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/orders/lookup">Look up an order</Link>
          </Button>
        </div>
      </Container>
    );
  }

  const order = await getOrderByNumber(orderNumber, email);
  if (!order) notFound();

  return (
    <Container className="max-w-2xl py-10 sm:py-16">
      <OrderDetail order={order} isNew={order.status === 'PENDING' || query.new === '1'} />

      <div className="mt-10 flex flex-wrap justify-center gap-3 print:hidden">
        <Button asChild variant="secondary">
          <Link href={ROUTES.shop}>Continue shopping</Link>
        </Button>

        {user ? (
          <Button asChild variant="ghost">
            <Link href={ROUTES.account.orders}>All your orders</Link>
          </Button>
        ) : null}
      </div>
    </Container>
  );
}
