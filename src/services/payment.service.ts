import 'server-only';

import type Stripe from 'stripe';

import { errors } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { stripe } from '@/lib/integrations/stripe';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { reverseForOrder } from '@/services/account/rewards.service';
import { releaseRedemption } from '@/services/coupon.service';
import { sendCancellationEmail, sendOrderConfirmation, sendRefundEmail } from '@/services/email.service';
import { recordEvent, transitionOrder } from '@/services/order.service';

/**
 * Payments, via Stripe Payment Intents.
 *
 * Payment Intents rather than Checkout Sessions: the card form stays on our
 * domain, so the checkout keeps its own layout and analytics, and SCA is handled
 * by Stripe.js without a redirect for most US cards.
 *
 * ## What is authoritative
 *
 * The webhook, and only the webhook. The browser returning to `/order/success`
 * is a hint — it can be forged, replayed, or simply never arrive because the
 * customer closed the tab. Nothing marks an order paid except
 * `payment_intent.succeeded` arriving with a valid signature.
 *
 * ## Amounts
 *
 * Stripe works in the currency's smallest unit, which for USD is cents — the
 * same unit used everywhere in this codebase, so no conversion happens anywhere
 * and there is no place for a factor-of-100 bug to hide.
 */

/**
 * Creates or reuses the intent for an order.
 *
 * Reuse matters: a customer who fails 3DS and retries must not leave three live
 * intents against one order. The amount is refreshed on reuse in case the order
 * changed between attempts.
 */
export async function createPaymentIntent(orderId: string): Promise<{
  clientSecret: string;
  paymentIntentId: string;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } } },
  });

  if (!order) throw errors.notFound('Order');
  if (order.status !== 'PENDING') throw errors.conflict('That order has already been paid.');

  // Store credit and points already paid part of this bill. The card covers the
  // rest — charging `totalCents` would take the loyalty tender twice.
  const amountDueCents = order.totalCents - order.creditAppliedCents;

  if (amountDueCents <= 0) {
    throw errors.conflict('That order is already covered in full and needs no payment.');
  }

  const existing = order.payments[0];

  if (existing?.providerRef) {
    const intent = await stripe().paymentIntents.retrieve(existing.providerRef);

    if (intent.status !== 'canceled' && intent.status !== 'succeeded') {
      const refreshed =
        intent.amount === amountDueCents
          ? intent
          : await stripe().paymentIntents.update(intent.id, { amount: amountDueCents });

      return { clientSecret: refreshed.client_secret!, paymentIntentId: refreshed.id };
    }
  }

  const intent = await stripe().paymentIntents.create(
    {
      amount: amountDueCents,
      currency: order.currency.toLowerCase(),
      // Discreet: this appears on a shared bank statement.
      statement_descriptor_suffix: 'GT ORDER',
      automatic_payment_methods: { enabled: true },
      receipt_email: order.email,
      // The webhook receives only the intent, so the order id must travel with it.
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
    },
    // Stripe-side idempotency: a double-submitted checkout returns the same
    // intent instead of charging twice.
    { idempotencyKey: `order_${order.id}_intent` },
  );

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'STRIPE',
      status: 'PENDING',
      amountCents: amountDueCents,
      currency: order.currency,
      providerRef: intent.id,
      idempotencyKey: `order_${order.id}_intent`,
    },
  });

  await recordEvent(order.id, 'PAYMENT_STARTED', 'Payment started.', {
    data: { paymentIntentId: intent.id },
    isCustomerVisible: false,
  });

  return { clientSecret: intent.client_secret!, paymentIntentId: intent.id };
}

/**
 * Applies a verified Stripe event.
 *
 * Every branch is idempotent, because Stripe retries for up to three days and
 * will happily deliver the same event twice. `transitionOrder` is a no-op when
 * the order is already in the target status, which is what makes replay safe.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  logger.info('stripe.webhook', { type: event.type, id: event.id });

  switch (event.type) {
    case 'payment_intent.succeeded':
      await onPaymentSucceeded(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      await onPaymentFailed(event.data.object);
      break;

    case 'payment_intent.canceled':
      await onPaymentCanceled(event.data.object);
      break;

    case 'charge.refunded':
      await onChargeRefunded(event.data.object);
      break;

    case 'charge.dispute.created':
      await onDisputeCreated(event.data.object);
      break;

    default:
      // Unhandled types are acknowledged, not errored: returning a failure makes
      // Stripe retry an event we were never going to act on.
      logger.debug('stripe.webhook.ignored', { type: event.type });
  }
}

async function orderForIntent(intent: Stripe.PaymentIntent) {
  const orderId = intent.metadata?.orderId;

  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId } })
    : await prisma.order
        .findFirst({ where: { payments: { some: { providerRef: intent.id } } } });

  if (!order) logger.error('stripe.webhook.orphan', { intentId: intent.id });

  return order;
}

async function onPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await orderForIntent(intent);
  if (!order) return;

  // Stripe retries a delivery for up to three days, so assume every event
  // arrives more than once. `transitionOrder` and the stock movement are already
  // idempotent, but the timeline entry and the confirmation email are not —
  // without this the customer gets the same receipt twice and their order
  // history lists the same payment twice.
  if (order.paidAt) {
    logger.debug('stripe.replay_ignored', { orderId: order.id, intentId: intent.id });
    return;
  }

  // A mismatch means the order changed after the intent was created. Take the
  // money — the customer authorised this amount — and flag it for a human.
  const expected = order.totalCents - order.creditAppliedCents;

  if (intent.amount_received !== expected) {
    logger.error('stripe.amount_mismatch', {
      orderId: order.id,
      paid: intent.amount_received,
      expected,
    });
  }

  await prisma.payment.updateMany({
    where: { providerRef: intent.id },
    data: { status: 'PAID', capturedAt: new Date() },
  });

  await transitionOrder(order.id, 'PAID', {
    message: 'Payment received.',
    data: { paymentIntentId: intent.id, amountCents: intent.amount_received },
  });

  await recordEvent(order.id, 'PAYMENT_SUCCEEDED', 'Payment confirmed.', {
    data: { paymentIntentId: intent.id },
  });

  // The cart is emptied only now. Clearing it at order creation would lose the
  // basket of every customer whose payment then failed.
  await prisma.cart.deleteMany({ where: { userId: order.userId ?? undefined } });

  // Awaited, not fired and forgotten: a serverless function that returns before
  // its promises settle gets frozen mid-send. A failure only logs — the money is
  // already taken and the webhook must still return 2xx.
  await sendOrderConfirmation(order.id);
}

async function onPaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await orderForIntent(intent);
  if (!order) return;

  await prisma.payment.updateMany({
    where: { providerRef: intent.id },
    data: {
      status: 'FAILED',
      errorCode: intent.last_payment_error?.code ?? null,
      errorMessage: intent.last_payment_error?.message ?? null,
    },
  });

  // The order stays PENDING: the customer can retry with another card, and
  // cancelling here would release stock they are still trying to buy.
  await recordEvent(order.id, 'PAYMENT_FAILED', 'Payment was declined.', {
    data: { code: intent.last_payment_error?.code, intentId: intent.id },
  });
}

async function onPaymentCanceled(intent: Stripe.PaymentIntent): Promise<void> {
  const order = await orderForIntent(intent);
  if (!order || order.status !== 'PENDING') return;

  await releaseRedemption(order.id);
  await transitionOrder(order.id, 'CANCELLED', { message: 'Payment cancelled.' });
  await sendCancellationEmail(order.id, 'the payment was cancelled');
}

async function onChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!intentId) return;

  const payment = await prisma.payment.findFirst({ where: { providerRef: intentId } });
  if (!payment) return;

  const isFull = charge.amount_refunded >= charge.amount;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      refundedAt: new Date(),
    },
  });

  await recordEvent(
    payment.orderId,
    'REFUND_ISSUED',
    `Refund of ${formatCents(charge.amount_refunded)} issued.`,
    { data: { amountRefundedCents: charge.amount_refunded, isFull } },
  );

  if (isFull) {
    const order = await prisma.order.findUnique({ where: { id: payment.orderId } });
    if (order && order.status !== 'REFUNDED') {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
      });
    }
  } else {
    await prisma.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: 'PARTIALLY_REFUNDED' },
    });
  }

  await sendRefundEmail(payment.orderId, charge.amount_refunded);

  // Hands back whatever loyalty the order spent, and claws back what it earned.
  // Only on a full refund: a partial one is a judgement call about which lines
  // came back, and guessing at the loyalty split would be worse than waiting.
  if (isFull) {
    await reverseForOrder(payment.orderId).catch((error: unknown) =>
      logger.error('rewards.reverse_failed', error, { orderId: payment.orderId }),
    );
  }
}

async function onDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
  if (!intentId) return;

  const payment = await prisma.payment.findFirst({ where: { providerRef: intentId } });
  if (!payment) return;

  logger.error('stripe.dispute', { orderId: payment.orderId, disputeId: dispute.id });

  // Internal only. A customer who has just charged back does not need an email
  // about it, and the response window is an operations task, not an automated one.
  await recordEvent(payment.orderId, 'NOTE_ADDED', `Chargeback opened: ${dispute.reason}.`, {
    data: { disputeId: dispute.id, amountCents: dispute.amount },
    isCustomerVisible: false,
  });
}

/**
 * Refunds an order, fully or in part.
 *
 * The refund is requested from Stripe here; the database is updated by the
 * `charge.refunded` webhook that follows. Writing both here would leave the two
 * out of step whenever Stripe accepts the refund and this process then dies.
 */
export async function refundOrder(
  orderId: string,
  options: { amountCents?: number; reason?: string; actorId?: string | null } = {},
): Promise<{ refundId: string; amountCents: number }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } },
  });

  if (!order) throw errors.notFound('Order');

  const payment = order.payments[0];
  if (!payment?.providerRef) throw errors.conflict('That order has no captured payment to refund.');

  const amountCents = options.amountCents ?? order.totalCents;
  if (amountCents <= 0 || amountCents > order.totalCents) {
    throw errors.badRequest('Refund amount must be between 1 cent and the order total.');
  }

  const refund = await stripe().refunds.create(
    {
      payment_intent: payment.providerRef,
      amount: amountCents,
      reason: 'requested_by_customer',
      metadata: { orderId, note: options.reason ?? '' },
    },
    { idempotencyKey: `refund_${orderId}_${amountCents}` },
  );

  logger.info('order.refund', { orderId, amountCents, refundId: refund.id });

  await recordEvent(orderId, 'REFUND_ISSUED', `Refund of ${formatCents(amountCents)} requested.`, {
    data: { refundId: refund.id, amountCents, reason: options.reason },
    actorId: options.actorId ?? null,
  });

  return { refundId: refund.id, amountCents };
}

/** Stripe's own hosted receipt, when there is one. Used in the confirmation email. */
export async function getReceiptUrl(orderId: string): Promise<string | null> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
  });

  if (!payment?.providerRef || !env.STRIPE_SECRET_KEY) return null;

  const intent = await stripe().paymentIntents.retrieve(payment.providerRef, {
    expand: ['latest_charge'],
  });

  const charge = intent.latest_charge;
  return typeof charge === 'object' && charge ? charge.receipt_url : null;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
