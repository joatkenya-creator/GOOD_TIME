import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Container } from '@/components/layout/container';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { orderLookupSchema } from '@/features/checkout/schemas';
import { getOrderByNumber } from '@/services/order.service';

/**
 * Guest order lookup.
 *
 * The order number alone is not enough — they are sequential and therefore
 * guessable — so the email must match too. A wrong pair returns the same generic
 * message as a nonexistent order, because "that order exists but you have the
 * wrong email" is a confirmation nobody outside the account should get.
 *
 * A plain server-action form: no client JavaScript, and it works from an email
 * client's in-app browser with scripts blocked.
 */
export const metadata: Metadata = {
  title: 'Track your order',
  robots: { index: false, follow: false },
};

export default async function OrderLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; email?: string; error?: string }>;
}) {
  const query = await searchParams;

  async function lookup(formData: FormData) {
    'use server';

    const parsed = orderLookupSchema.safeParse({
      orderNumber: formData.get('orderNumber'),
      email: formData.get('email'),
    });

    if (!parsed.success) redirect('/orders/lookup?error=1');

    const orderNumber = parsed.data.orderNumber.toUpperCase();
    const order = await getOrderByNumber(orderNumber, parsed.data.email);

    if (!order) redirect('/orders/lookup?error=1');

    redirect(`/order/${orderNumber}?email=${encodeURIComponent(parsed.data.email)}`);
  }

  return (
    <Container className="max-w-md py-16">
      <h1 className="text-h2 font-bold text-foreground">Track your order</h1>
      <p className="mt-2 text-body-sm text-foreground-muted">
        Enter the order number from your confirmation email and the address it was sent to.
      </p>

      {query.error ? (
        <Alert variant="danger" title="We could not find that order" className="mt-6">
          Check the order number and email address and try again.
        </Alert>
      ) : null}

      <form action={lookup} className="mt-8 space-y-5">
        <div>
          <label
            htmlFor="orderNumber"
            className="mb-1.5 block text-body-sm font-medium text-foreground"
          >
            Order number
          </label>
          <Input
            id="orderNumber"
            name="orderNumber"
            required
            placeholder="GT-100042"
            defaultValue={query.order ?? ''}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-body-sm font-medium text-foreground">
            Email address
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            defaultValue={query.email ?? ''}
          />
        </div>

        <Button type="submit" size="lg" className="w-full">
          Find my order
        </Button>
      </form>
    </Container>
  );
}
