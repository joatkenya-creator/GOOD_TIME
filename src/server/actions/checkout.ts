'use server';

import { headers } from 'next/headers';

import { checkoutSchema, type CheckoutInput } from '@/features/checkout/schemas';
import { isAppError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/server/auth/session';
import { getCart } from '@/services/cart.service';
import { sendNewsletterConfirmation } from '@/services/email.service';
import { placeOrder } from '@/services/order.service';
import { createPaymentIntent } from '@/services/payment.service';

/**
 * The checkout submit.
 *
 * One action does two things that must not be split across requests: create the
 * order and create the payment intent for it. Splitting them leaves orders with
 * no intent whenever the second call fails, and those are indistinguishable from
 * abandoned checkouts in every report afterwards.
 */

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      clientSecret: string;
      /**
       * The amount actually about to be charged.
       *
       * Returned because the cart and checkout summaries show a tax *estimate* —
       * the real figure only exists once an address has been quoted against the
       * tax provider, which happens here. Sending someone to a card form without
       * showing them the final number is how a chargeback starts.
       */
      totals: { subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number };
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function submitCheckoutAction(input: CheckoutInput): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    }
    return { ok: false, message: 'Please check the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;

  try {
    const user = await getSessionUser();
    const cart = await getCart(user?.id, false);

    if (!cart || cart.items.every((item) => item.savedForLater)) {
      return { ok: false, message: 'Your bag is empty.' };
    }

    // The order snapshots its own destination (see `shippingAddressSnapshot`), so
    // these rows are purely the customer's address book. Written only when they
    // asked for it — a row per order would fill the book with duplicates, and a
    // guest has no account to attach one to.
    let shippingAddressId: string | null = null;
    let billingAddressId: string | null = null;

    if (user && data.saveAddress) {
      const shipping = await prisma.address.create({
        data: { ...toAddressRow(data.shippingAddress), userId: user.id, type: 'SHIPPING' },
      });
      shippingAddressId = shipping.id;

      if (!data.billingSameAsShipping && data.billingAddress) {
        const billing = await prisma.address.create({
          data: { ...toAddressRow(data.billingAddress), userId: user.id, type: 'BILLING' },
        });
        billingAddressId = billing.id;
      }
    }

    const headerList = await headers();

    const order = await placeOrder({
      cartId: cart.id,
      userId: user?.id ?? null,
      email: data.email,
      shippingAddressId,
      billingAddressId,
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingSameAsShipping ? null : (data.billingAddress ?? null),
      shippingRateId: data.shippingRateId,
      customerNote: data.customerNote || null,
      // Recorded for fraud review. `x-forwarded-for` is a list; the first entry
      // is the client.
      ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: headerList.get('user-agent'),
    });

    const { clientSecret } = await createPaymentIntent(order.id);

    if (data.subscribe) {
      // A failed newsletter signup must never fail an order. Double opt-in, so
      // the row is created unconfirmed and nothing is sent until they click.
      try {
        await prisma.newsletterSubscriber.upsert({
          where: { email: data.email.toLowerCase() },
          update: {},
          create: { email: data.email.toLowerCase(), source: 'checkout' },
        });
        await sendNewsletterConfirmation(data.email.toLowerCase());
      } catch (error) {
        logger.warn('newsletter.subscribe_failed', { error });
      }
    }

    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      clientSecret,
      totals: {
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
      },
    };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };

    logger.error('checkout.submit_failed', error);
    return { ok: false, message: 'We could not start your order. Please try again.' };
  }
}

/** Re-issues a client secret when a customer returns to an unpaid order. */
export async function resumePaymentAction(
  orderId: string,
): Promise<{ ok: true; clientSecret: string } | { ok: false; message: string }> {
  try {
    const { clientSecret } = await createPaymentIntent(orderId);
    return { ok: true, clientSecret };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };
    return { ok: false, message: 'We could not resume that payment.' };
  }
}

function toAddressRow(address: CheckoutInput['shippingAddress']) {
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company || null,
    line1: address.line1,
    line2: address.line2 || null,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone || null,
  };
}
