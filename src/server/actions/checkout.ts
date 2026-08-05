'use server';

import { headers } from 'next/headers';

import { checkoutSchema, type CheckoutInput } from '@/features/checkout/schemas';
import { isAppError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/server/auth/session';
import { getCart } from '@/services/cart.service';
import { sendNewsletterConfirmation, sendOrderConfirmation } from '@/services/email.service';
import { placeOrder, transitionOrder } from '@/services/order.service';
import {
  authorizePayment,
  createPaymentSession,
  type AuthorizeResult,
} from '@/services/payment.service';

/**
 * The checkout submit.
 *
 * One action does two things that must not be split across requests: create the
 * order and open the Klarna session for it. Splitting them leaves orders with no
 * session whenever the second call fails, and those are indistinguishable from
 * abandoned checkouts in every report afterwards.
 *
 * The session is not the payment. Klarna authorises in the browser, hands back
 * a single-use token, and `authorizeCheckoutAction` below converts that into a
 * real Klarna order server-side — see `services/payment.service.ts`.
 */

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      /**
       * Mounts the Klarna widget in the browser. Null when store credit covered
       * the whole bill and no payment is needed at all.
       */
      clientToken: string | null;
      /** Which Klarna products this customer is eligible for, in display order. */
      paymentMethodCategories: { identifier: string; name: string }[];
      /**
       * The amount actually about to be charged.
       *
       * Returned because the cart and checkout summaries show a tax *estimate* —
       * the real figure only exists once an address has been quoted against the
       * tax provider, which happens here. Sending someone to a payment widget
       * without showing them the final number is how a dispute starts.
       */
      totals: {
        subtotalCents: number;
        shippingCents: number;
        taxCents: number;
        totalCents: number;
        /** Paid by loyalty rather than by card. */
        creditAppliedCents: number;
        /** What Klarna is actually asked to fund. */
        amountDueCents: number;
      };
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

    /*
     * An order fully covered by store credit has nothing to charge.
     *
     * Klarna rejects a zero-amount session, and rightly so — there is no payment
     * to make. The order is marked paid directly, which runs the same transition
     * a webhook would: stock is committed, points are awarded, the confirmation
     * is sent.
     */
    const amountDueCents = order.totalCents - order.creditAppliedCents;

    if (amountDueCents <= 0) {
      await transitionOrder(order.id, 'PAID', {
        message: 'Paid in full with store credit.',
        data: { creditAppliedCents: order.creditAppliedCents },
      });

      await sendOrderConfirmation(order.id);

      return {
        ok: true,
        orderId: order.id,
        orderNumber: order.orderNumber,
        clientToken: null,
        paymentMethodCategories: [],
        totals: {
          subtotalCents: order.subtotalCents,
          shippingCents: order.shippingCents,
          taxCents: order.taxCents,
          totalCents: order.totalCents,
          creditAppliedCents: order.creditAppliedCents,
          amountDueCents: 0,
        },
      };
    }

    const session = await createPaymentSession(order.id);

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
      clientToken: session.clientToken,
      paymentMethodCategories: session.paymentMethodCategories,
      totals: {
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        creditAppliedCents: order.creditAppliedCents,
        amountDueCents,
      },
    };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };

    logger.error('checkout.submit_failed', error);
    return { ok: false, message: 'We could not start your order. Please try again.' };
  }
}

/** Re-opens a Klarna session when a customer returns to an unpaid order. */
export async function resumePaymentAction(orderId: string): Promise<
  | {
      ok: true;
      clientToken: string;
      paymentMethodCategories: { identifier: string; name: string }[];
    }
  | { ok: false; message: string }
> {
  try {
    const session = await createPaymentSession(orderId);
    return {
      ok: true,
      clientToken: session.clientToken,
      paymentMethodCategories: session.paymentMethodCategories,
    };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };
    return { ok: false, message: 'We could not resume that payment.' };
  }
}

/**
 * Converts the browser's Klarna authorization token into a placed order.
 *
 * Deliberately server-side. The token is single-use and placing the order is
 * the moment the customer becomes liable, so it happens somewhere we control,
 * can rate-limit and can audit — never from a client-side call to Klarna.
 */
export async function authorizeCheckoutAction(
  orderId: string,
  authorizationToken: string,
): Promise<AuthorizeResult | { status: 'error'; message: string }> {
  if (!authorizationToken || authorizationToken.length > 512) {
    return { status: 'error', message: 'That payment could not be completed.' };
  }

  try {
    return await authorizePayment(orderId, authorizationToken);
  } catch (error) {
    if (isAppError(error)) return { status: 'error', message: error.message };

    logger.error('checkout.authorize_failed', error, { orderId });
    return {
      status: 'error',
      message: 'We could not complete that payment. You have not been charged.',
    };
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
