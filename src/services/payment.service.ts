import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { errors } from '@/lib/api/errors';
import { publicEnv } from '@/lib/env.public';
import {
  cancelAuthorization,
  cancelOrder,
  captureOrder,
  createSession,
  extendAuthorization,
  KlarnaError,
  placeOrder as placeKlarnaOrder,
  readOrder,
  refundOrderAmount,
  updateSession,
  type CreateSessionInput,
  type KlarnaAddress,
  type KlarnaManagedOrder,
  type KlarnaOrderLine,
} from '@/lib/integrations/klarna';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { reverseForOrder } from '@/services/account/rewards.service';
import { releaseRedemption } from '@/services/coupon.service';
import {
  sendCancellationEmail,
  sendOrderConfirmation,
  sendRefundEmail,
} from '@/services/email.service';
import { recordEvent, transitionOrder } from '@/services/order.service';

/**
 * Payments, via Klarna.
 *
 * ## The model is authorise-then-capture, and that is not a detail
 *
 * Klarna is not a card gateway with a different logo. At checkout the customer
 * is *authorised*: Klarna underwrites them, guarantees the merchant, and holds
 * the amount against their credit line. No money moves. Money moves when we
 * *capture*, and Klarna's merchant terms require that to happen at fulfilment —
 * capturing before you ship is a compliance problem, not a cash-flow choice.
 *
 * So there are two events where a card processor has one:
 *
 *   - **Authorisation** (`authorizePayment`) — the customer's obligation is
 *     fixed and Klarna carries the risk. This is the moment it becomes safe to
 *     fulfil, so this is what moves the order to `PAID` and sends the receipt.
 *   - **Capture** (`captureForOrder`) — called from the fulfilment service when
 *     a shipment is created. The `Payment` row moves `AUTHORIZED` → `PAID`.
 *
 * `Order.status` therefore tracks "can we ship this" and `Payment.status`
 * tracks where the money is. Conflating them is how a warehouse ends up
 * shipping against an authorisation that lapsed three weeks ago.
 *
 * ## Authorisations expire
 *
 * Klarna authorisations lapse, typically after 28 days. An item on backorder
 * that ships on day 30 cannot be captured and the revenue is simply gone. The
 * nightly `klarna.reconcile` job extends anything approaching expiry; see
 * `lib/jobs/handlers.ts`.
 *
 * ## What is authoritative
 *
 * Klarna's own record of the order, always. Its push notification carries an
 * `order_id` and nothing else worth trusting, so every asynchronous path here
 * re-reads the order from Klarna and applies *that*. A forged push triggers a
 * lookup and changes nothing.
 *
 * ## Amounts
 *
 * Klarna works in the currency's minor unit — cents for USD — which is the unit
 * used everywhere in this codebase. Nothing converts anywhere, so there is no
 * place for a factor-of-100 bug to hide.
 */

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** Address snapshots are JSON; this is the shape checkout writes. */
interface AddressSnapshot {
  firstName?: string;
  lastName?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string | null;
}

function toKlarnaAddress(snapshot: unknown, email: string): KlarnaAddress | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const address = snapshot as AddressSnapshot;

  return {
    ...(address.firstName ? { given_name: address.firstName } : {}),
    ...(address.lastName ? { family_name: address.lastName } : {}),
    email,
    ...(address.line1 ? { street_address: address.line1 } : {}),
    ...(address.line2 ? { street_address2: address.line2 } : {}),
    ...(address.postalCode ? { postal_code: address.postalCode } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.state ? { region: address.state } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.country ? { country: address.country } : {}),
  };
}

/**
 * Builds the line items Klarna shows the customer.
 *
 * Klarna renders these verbatim in its widget and in the customer's Klarna app,
 * so this is not bookkeeping — it is what the buyer reads while deciding
 * whether to confirm. It must match the order summary they just saw, to the
 * cent.
 *
 * Klarna refuses a session whose lines do not sum to `order_amount`. Rounding
 * in per-line discounts is the usual cause, so any residual lands on an
 * explicit adjustment line rather than failing the whole checkout.
 */
export function buildOrderLines(order: OrderWithItems): KlarnaOrderLine[] {
  const lines: KlarnaOrderLine[] = order.items.map((item) => ({
    type: 'physical',
    reference: item.sku,
    name:
      item.productName === item.variantName
        ? item.productName
        : `${item.productName} — ${item.variantName}`,
    quantity: item.quantity,
    unit_price: item.unitPriceCents,
    // Tax is quoted for the order as a whole by the tax provider, never per
    // line, so the lines are declared tax-exclusive and tax is its own line.
    tax_rate: 0,
    total_amount: item.unitPriceCents * item.quantity - item.discountCents,
    total_tax_amount: 0,
    ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
  }));

  if (order.shippingCents > 0) {
    lines.push({
      type: 'shipping_fee',
      name: 'Shipping',
      quantity: 1,
      unit_price: order.shippingCents,
      tax_rate: 0,
      total_amount: order.shippingCents,
      total_tax_amount: 0,
    });
  }

  if (order.taxCents > 0) {
    lines.push({
      type: 'sales_tax',
      name: 'Sales tax',
      quantity: 1,
      unit_price: order.taxCents,
      tax_rate: 0,
      total_amount: order.taxCents,
      total_tax_amount: 0,
    });
  }

  /*
   * Store credit and loyalty points are tender, not a discount — but Klarna
   * only ever authorises what it is actually being asked to fund. Presenting
   * the credit as a negative line is what makes the total in the Klarna widget
   * equal the amount the customer will really be billed.
   */
  if (order.creditAppliedCents > 0) {
    lines.push({
      type: 'discount',
      name: 'Store credit and rewards',
      quantity: 1,
      unit_price: -order.creditAppliedCents,
      tax_rate: 0,
      total_amount: -order.creditAppliedCents,
      total_tax_amount: 0,
    });
  }

  const expected = order.totalCents - order.creditAppliedCents;
  const summed = lines.reduce((total, line) => total + line.total_amount, 0);

  if (summed !== expected) {
    /*
     * A residual cent, not a bug to hide.
     *
     * Per-item discounts round, and Klarna refuses the entire session over a
     * one-cent mismatch with an error the customer cannot act on. An explicit
     * adjustment line is visible and auditable and keeps checkout working; the
     * log line is what makes a *large* delta findable, because that one is a
     * real bug.
     */
    const delta = expected - summed;

    if (Math.abs(delta) > 5) {
      logger.error('klarna.line_total_mismatch', new Error('Order lines do not sum to total'), {
        orderId: order.id,
        expected,
        summed,
        delta,
      });
    }

    lines.push({
      type: 'discount',
      name: 'Rounding adjustment',
      quantity: 1,
      unit_price: delta,
      tax_rate: 0,
      total_amount: delta,
      total_tax_amount: 0,
    });
  }

  return lines;
}

function pushToken(): string {
  // Absent in development, where Klarna cannot reach localhost anyway. The
  // production gate is `productionReadiness()`.
  return process.env.KLARNA_WEBHOOK_SECRET ?? 'unconfigured';
}

function sessionInput(order: OrderWithItems): CreateSessionInput {
  const amountDueCents = order.totalCents - order.creditAppliedCents;
  const shipping = toKlarnaAddress(order.shippingAddressSnapshot, order.email);
  const billing = toKlarnaAddress(order.billingAddressSnapshot, order.email) ?? shipping;
  const country = shipping?.country ?? 'US';
  const site = publicEnv.NEXT_PUBLIC_SITE_URL;

  return {
    purchase_country: country,
    purchase_currency: order.currency,
    locale: country === 'US' ? 'en-US' : 'en-GB',
    order_amount: amountDueCents,
    order_tax_amount: order.taxCents,
    order_lines: buildOrderLines(order),
    // Surfaces our order number in the Klarna merchant portal, which is what
    // support reads when a customer calls Klarna instead of calling us.
    merchant_reference1: order.orderNumber,
    merchant_urls: {
      confirmation: `${site}/order/${order.orderNumber}?email=${encodeURIComponent(order.email)}`,
      // Klarna does not sign its pushes, so the shared secret lives in the
      // path. See `verifyPushToken` in the integration module.
      notification: `${site}/api/webhooks/klarna/${pushToken()}`,
      push: `${site}/api/webhooks/klarna/${pushToken()}`,
    },
    ...(billing ? { billing_address: billing } : {}),
    ...(shipping ? { shipping_address: shipping } : {}),
  };
}

export interface PaymentSession {
  clientToken: string;
  sessionId: string;
  /** Which Klarna products this customer is eligible for, in display order. */
  paymentMethodCategories: { identifier: string; name: string }[];
}

interface SessionMetadata {
  sessionId?: string;
  clientToken?: string;
  categories?: { identifier: string; name: string }[];
  authorizationToken?: string;
}

/**
 * Creates or refreshes the Klarna session for an order.
 *
 * Refresh matters: a customer who backs out to edit their address and returns
 * must not leave two live sessions, and Klarna scores the *session*, so a stale
 * amount is rejected at authorisation with a message nobody can act on.
 */
export async function createPaymentSession(orderId: string): Promise<PaymentSession> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!order) throw errors.notFound('Order');
  if (order.status !== 'PENDING') throw errors.conflict('That order has already been paid.');

  // Store credit and points already paid part of this bill. Klarna funds the
  // rest — authorising `totalCents` would take the loyalty tender twice.
  const amountDueCents = order.totalCents - order.creditAppliedCents;

  if (amountDueCents <= 0) {
    throw errors.conflict('That order is already covered in full and needs no payment.');
  }

  const input = sessionInput(order);
  const existing = order.payments[0];
  const stored = (existing?.metadata ?? null) as SessionMetadata | null;

  if (existing && stored?.sessionId && stored.clientToken) {
    try {
      // 204 with no body: the stored client token stays valid for this session,
      // which is exactly why it is kept on the payment row.
      await updateSession(stored.sessionId, input);

      if (existing.amountCents !== amountDueCents) {
        await prisma.payment.update({
          where: { id: existing.id },
          data: { amountCents: amountDueCents },
        });
      }

      return {
        clientToken: stored.clientToken,
        sessionId: stored.sessionId,
        paymentMethodCategories: stored.categories ?? [],
      };
    } catch (error) {
      // An expired or unknown session is not worth showing anyone — fall
      // through and open a fresh one.
      logger.warn('klarna.session_refresh_failed', {
        orderId,
        sessionId: stored.sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { data: session } = await createSession(input);

  const categories = (session.payment_method_categories ?? []).map((category) => ({
    identifier: category.identifier,
    name: category.name,
  }));

  const metadata = {
    sessionId: session.session_id,
    clientToken: session.client_token,
    categories,
  } as unknown as Prisma.InputJsonValue;

  if (existing) {
    await prisma.payment.update({
      where: { id: existing.id },
      data: { amountCents: amountDueCents, metadata },
    });
  } else {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'KLARNA',
        status: 'PENDING',
        amountCents: amountDueCents,
        currency: order.currency,
        idempotencyKey: `order_${order.id}_session`,
        metadata,
      },
    });
  }

  await recordEvent(order.id, 'PAYMENT_STARTED', 'Klarna checkout started.', {
    data: { sessionId: session.session_id },
    isCustomerVisible: false,
  });

  return {
    clientToken: session.client_token,
    sessionId: session.session_id,
    paymentMethodCategories: categories,
  };
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

export type AuthorizeResult =
  | { status: 'authorized'; orderNumber: string; klarnaOrderId: string }
  | { status: 'pending'; orderNumber: string; klarnaOrderId: string }
  | { status: 'redirect'; redirectUrl: string }
  | { status: 'rejected'; message: string };

/**
 * Turns a Klarna authorization token into a real Klarna order.
 *
 * Called from the server once the browser widget hands back a token, never from
 * the browser directly: the token is single-use and placing the order is what
 * commits the customer, so it happens somewhere we control and can audit.
 *
 * Idempotent by construction. The Klarna idempotency key is derived from our
 * order id, so a double-submitted form returns the same Klarna order rather
 * than placing a second one, and the `paidAt` guard stops a second receipt.
 */
export async function authorizePayment(
  orderId: string,
  authorizationToken: string,
): Promise<AuthorizeResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });

  if (!order) throw errors.notFound('Order');

  if (order.paidAt) {
    // Already done. Reporting success is correct — the customer's browser
    // retried, not their payment.
    const existing = await prisma.payment.findFirst({
      where: { orderId, status: { in: ['AUTHORIZED', 'PAID'] } },
      select: { providerRef: true },
    });

    return {
      status: 'authorized',
      orderNumber: order.orderNumber,
      klarnaOrderId: existing?.providerRef ?? '',
    };
  }

  let placed;

  try {
    placed = await placeKlarnaOrder(
      authorizationToken,
      // Never `auto_capture`. Klarna's terms require capture at fulfilment, and
      // the fulfilment service is what calls `captureForOrder`.
      { ...sessionInput(order), auto_capture: false },
      `order_${order.id}_authorize`,
    );
  } catch (error) {
    if (error instanceof KlarnaError) {
      await prisma.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          errorCode: error.errorCode,
          errorMessage: error.messages.join('; ').slice(0, 500),
        },
      });

      await recordEvent(order.id, 'PAYMENT_FAILED', 'Klarna declined the payment.', {
        data: { errorCode: error.errorCode, messages: error.messages },
      });

      logger.warn('klarna.authorize_declined', {
        orderId,
        errorCode: error.errorCode,
        correlationId: error.correlationId,
      });

      // The order stays PENDING: the customer can retry with another Klarna
      // product, and cancelling here would release stock they are still buying.
      return {
        status: 'rejected',
        message: 'Klarna could not approve this purchase. Try another payment option.',
      };
    }

    throw error;
  }

  const klarna = placed.data;

  // Klarna asks for a redirect when the customer must finish in its own flow —
  // a bank sign-in, an app confirmation. The order is real by then; the
  // customer simply is not back yet.
  if (klarna.redirect_url && klarna.fraud_status === 'PENDING') {
    await recordPending(order.id, klarna.order_id);
    return { status: 'redirect', redirectUrl: klarna.redirect_url };
  }

  if (klarna.fraud_status === 'REJECTED') {
    await prisma.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'FAILED', providerRef: klarna.order_id, errorCode: 'FRAUD_REJECTED' },
    });

    await recordEvent(order.id, 'PAYMENT_FAILED', 'Klarna rejected the order after review.', {
      data: { klarnaOrderId: klarna.order_id },
      isCustomerVisible: false,
    });

    return {
      status: 'rejected',
      message: 'Klarna could not approve this purchase. Try another payment option.',
    };
  }

  if (klarna.fraud_status === 'PENDING') {
    await recordPending(order.id, klarna.order_id);
    return { status: 'pending', orderNumber: order.orderNumber, klarnaOrderId: klarna.order_id };
  }

  await markAuthorized(order.id, klarna.order_id, order.totalCents - order.creditAppliedCents);

  return { status: 'authorized', orderNumber: order.orderNumber, klarnaOrderId: klarna.order_id };
}

/**
 * Klarna is still reviewing.
 *
 * The order stays `PENDING`: stock stays reserved, nothing ships, no receipt
 * goes out. Klarna pushes `FRAUD_RISK_ACCEPTED` or `FRAUD_RISK_STOPPED` within
 * minutes to hours, and `syncFromKlarna` resolves it.
 */
async function recordPending(orderId: string, klarnaOrderId: string): Promise<void> {
  await prisma.payment.updateMany({
    where: { orderId, status: 'PENDING' },
    data: { providerRef: klarnaOrderId },
  });

  await recordEvent(orderId, 'PAYMENT_STARTED', 'Klarna is reviewing this order.', {
    data: { klarnaOrderId },
  });
}

/**
 * The order is funded and safe to fulfil.
 *
 * Guarded on `paidAt`, because Klarna retries a push for hours and this is the
 * path a replay lands on. Without the guard the customer gets the same receipt
 * twice and their order history lists the same payment twice.
 */
async function markAuthorized(
  orderId: string,
  klarnaOrderId: string,
  amountCents: number,
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paidAt) {
    logger.debug('klarna.replay_ignored', { orderId, klarnaOrderId });
    return;
  }

  await prisma.payment.updateMany({
    where: { orderId, status: 'PENDING' },
    data: { status: 'AUTHORIZED', providerRef: klarnaOrderId, amountCents },
  });

  await transitionOrder(orderId, 'PAID', {
    message: 'Klarna authorised the payment.',
    data: { klarnaOrderId, amountCents },
  });

  await recordEvent(orderId, 'PAYMENT_SUCCEEDED', 'Payment confirmed by Klarna.', {
    data: { klarnaOrderId },
  });

  // The cart is emptied only now. Clearing it at order creation would lose the
  // basket of every customer whose payment then failed.
  if (order.userId) await prisma.cart.deleteMany({ where: { userId: order.userId } });

  // Awaited, not fired and forgotten: an isolate that returns before its
  // promises settle is frozen mid-send. A failure only logs — the customer is
  // already committed and the caller must still succeed.
  await sendOrderConfirmation(orderId).catch((error: unknown) =>
    logger.error('email.confirmation_failed', error, { orderId }),
  );
}

// ---------------------------------------------------------------------------
// Reconciliation — the authoritative path
// ---------------------------------------------------------------------------

/**
 * Re-reads an order from Klarna and makes the database agree with it.
 *
 * Every asynchronous path funnels through here: the push notification, the
 * nightly reconcile job, and the admin's "refresh from Klarna" button. Klarna's
 * record wins, always — ours is a cache of theirs, and a divergence is either a
 * notification we missed or a state we got wrong.
 *
 * Returns what it changed, so the reconcile job can report a number rather than
 * "done".
 */
export async function syncFromKlarna(klarnaOrderId: string): Promise<{
  orderId: string | null;
  changed: string[];
}> {
  const payment = await prisma.payment.findFirst({
    where: { provider: 'KLARNA', providerRef: klarnaOrderId },
    include: { order: true },
  });

  if (!payment) {
    logger.error('klarna.orphan_notification', new Error('No payment for Klarna order'), {
      klarnaOrderId,
    });
    return { orderId: null, changed: [] };
  }

  const { data: remote } = await readOrder(klarnaOrderId);
  const changed: string[] = [];

  // --- Fraud review resolved -----------------------------------------------
  if (remote.fraud_status === 'ACCEPTED' && !payment.order.paidAt) {
    await markAuthorized(payment.orderId, klarnaOrderId, remote.order_amount);
    changed.push('authorized');
  }

  if (remote.fraud_status === 'REJECTED' && payment.status !== 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', errorCode: 'FRAUD_REJECTED' },
    });

    // Klarna has withdrawn its guarantee, so the stock must go back.
    await releaseRedemption(payment.orderId).catch(() => undefined);
    await transitionOrder(payment.orderId, 'CANCELLED', {
      message: 'Klarna rejected the order after review.',
    });
    await sendCancellationEmail(payment.orderId, 'the payment could not be approved');
    changed.push('rejected');
  }

  // --- Money movement ------------------------------------------------------
  if (!changed.includes('rejected')) {
    const status = paymentStatusFor(remote);

    if (status && status !== payment.status) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status,
          ...(status === 'PAID' && !payment.capturedAt ? { capturedAt: new Date() } : {}),
          ...(remote.refunded_amount > 0 && !payment.refundedAt ? { refundedAt: new Date() } : {}),
        },
      });
      changed.push(`payment:${status}`);
    }
  }

  // --- A refund issued by hand in the Klarna portal -------------------------
  if (
    remote.captured_amount > 0 &&
    remote.refunded_amount >= remote.captured_amount &&
    payment.order.status !== 'REFUNDED'
  ) {
    await prisma.order.update({
      where: { id: payment.orderId },
      data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
    });

    /*
     * Record it on the timeline, exactly as `refundOrder` would.
     *
     * This branch is the one that fires when somebody refunds in the Klarna
     * merchant portal rather than through our admin. Without this event the
     * money moves, the order flips to REFUNDED, and there is nothing on the
     * customer's timeline or in the admin saying why — which is precisely the
     * case where an audit trail is most needed, because the action happened
     * somewhere we do not control.
     */
    await recordEvent(
      payment.orderId,
      'REFUND_ISSUED',
      `Refund of ${formatCents(remote.refunded_amount)} reconciled from Klarna.`,
      {
        data: {
          klarnaOrderId,
          amountRefundedCents: remote.refunded_amount,
          capturedCents: remote.captured_amount,
          // Distinguishes it from a refund we initiated, which matters when
          // someone asks who authorised it.
          source: 'klarna-reconcile',
        },
      },
    );

    await reverseForOrder(payment.orderId).catch((error: unknown) =>
      logger.error('rewards.reverse_failed', error, { orderId: payment.orderId }),
    );
    changed.push('refunded');
  }

  if (changed.length > 0) {
    logger.info('klarna.reconciled', { klarnaOrderId, orderId: payment.orderId, changed });
  }

  return { orderId: payment.orderId, changed };
}

/** Klarna's order state mapped onto ours. `null` means "leave it alone". */
function paymentStatusFor(remote: KlarnaManagedOrder) {
  if (remote.refunded_amount > 0 && remote.refunded_amount >= remote.captured_amount) {
    return 'REFUNDED' as const;
  }
  if (remote.refunded_amount > 0) return 'PARTIALLY_REFUNDED' as const;
  if (remote.status === 'CAPTURED') return 'PAID' as const;
  if (remote.status === 'PART_CAPTURED' || remote.status === 'AUTHORIZED') {
    return 'AUTHORIZED' as const;
  }
  if (remote.status === 'CANCELLED' || remote.status === 'EXPIRED') return 'FAILED' as const;
  return null;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Captures funds for an order, in full or in part.
 *
 * Called when a shipment is created. Partial capture is the right behaviour for
 * a split shipment: capture what shipped, leave the rest authorised, and
 * release the remainder when the order is complete.
 *
 * The idempotency key includes the amount, so a retried capture of the same
 * amount is one capture while a genuine second capture still goes through.
 */
export async function captureForOrder(
  orderId: string,
  options: { amountCents?: number; description?: string; actorId?: string | null } = {},
): Promise<{ captureId: string | null; amountCents: number }> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: 'KLARNA', status: { in: ['AUTHORIZED', 'PAID'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment?.providerRef) {
    throw errors.conflict('That order has no authorised Klarna payment to capture.');
  }

  const { data: remote } = await readOrder(payment.providerRef);
  const amountCents = options.amountCents ?? remote.remaining_authorized_amount;

  if (amountCents <= 0) {
    // Everything is captured already. Not an error — a second shipment on a
    // fully captured order is a normal thing for a warehouse to do.
    logger.info('klarna.capture_skipped', { orderId, reason: 'nothing remaining' });
    return { captureId: null, amountCents: 0 };
  }

  if (amountCents > remote.remaining_authorized_amount) {
    throw errors.conflict(
      `Klarna has only ${formatCents(remote.remaining_authorized_amount)} left authorised on that order.`,
    );
  }

  const { captureId } = await captureOrder(payment.providerRef, amountCents, {
    description: options.description ?? 'Order shipped',
    idempotencyKey: `capture_${orderId}_${amountCents}`,
  });

  const capturedTotal = remote.captured_amount + amountCents;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: capturedTotal >= remote.original_order_amount ? 'PAID' : 'AUTHORIZED',
      capturedAt: new Date(),
    },
  });

  await recordEvent(orderId, 'PAYMENT_SUCCEEDED', `Captured ${formatCents(amountCents)}.`, {
    data: { captureId, amountCents, klarnaOrderId: payment.providerRef },
    actorId: options.actorId ?? null,
    isCustomerVisible: false,
  });

  logger.info('klarna.captured', { orderId, amountCents, captureId });

  return { captureId, amountCents };
}

// ---------------------------------------------------------------------------
// Refund and cancellation
// ---------------------------------------------------------------------------

/**
 * Refunds an order, fully or in part.
 *
 * Unlike a card gateway there is no refund webhook to wait for: Klarna's
 * response *is* the confirmation, so the database is updated here. The nightly
 * reconcile still re-reads the order, which is what catches a refund issued by
 * hand in the Klarna portal.
 *
 * Refunds apply only to captured money. An order that is authorised but not yet
 * captured is *cancelled* instead — see `cancelPayment` — because refunding
 * money that never moved is not something Klarna will do.
 */
export async function refundOrder(
  orderId: string,
  options: { amountCents?: number; reason?: string; actorId?: string | null } = {},
): Promise<{ refundId: string | null; amountCents: number }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      payments: {
        where: { provider: 'KLARNA', status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'AUTHORIZED'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) throw errors.notFound('Order');

  const payment = order.payments[0];
  if (!payment?.providerRef) throw errors.conflict('That order has no Klarna payment to refund.');

  const { data: remote } = await readOrder(payment.providerRef);

  if (remote.captured_amount === 0) {
    throw errors.conflict(
      'Nothing has been captured on that order yet. Cancel the authorisation instead.',
    );
  }

  const refundable = remote.captured_amount - remote.refunded_amount;
  const amountCents = options.amountCents ?? refundable;

  if (amountCents <= 0 || amountCents > refundable) {
    throw errors.badRequest(
      `Refund must be between 1 cent and ${formatCents(refundable)}, the amount still refundable.`,
    );
  }

  const { refundId } = await refundOrderAmount(payment.providerRef, amountCents, {
    description: options.reason ?? 'Refund',
    // Includes the already-refunded total, so two deliberate refunds of the
    // same amount are two refunds while a retry of one is still one.
    idempotencyKey: `refund_${orderId}_${amountCents}_${remote.refunded_amount}`,
  });

  const isFull = remote.refunded_amount + amountCents >= remote.captured_amount;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: isFull ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedAt: new Date() },
  });

  await prisma.order.update({
    where: { id: orderId },
    data: isFull
      ? { status: 'REFUNDED', paymentStatus: 'REFUNDED' }
      : { paymentStatus: 'PARTIALLY_REFUNDED' },
  });

  await recordEvent(orderId, 'REFUND_ISSUED', `Refund of ${formatCents(amountCents)} issued.`, {
    data: { refundId, amountCents, isFull, reason: options.reason },
    actorId: options.actorId ?? null,
  });

  await sendRefundEmail(orderId, amountCents).catch((error: unknown) =>
    logger.error('email.refund_failed', error, { orderId }),
  );

  /*
   * Hands back whatever loyalty the order spent, and claws back what it earned.
   * Only on a full refund: a partial one is a judgement call about which lines
   * came back, and guessing at the loyalty split would be worse than waiting.
   */
  if (isFull) {
    await reverseForOrder(orderId).catch((error: unknown) =>
      logger.error('rewards.reverse_failed', error, { orderId }),
    );
  }

  logger.info('order.refund', { orderId, amountCents, refundId });

  return { refundId, amountCents };
}

/**
 * Releases an authorisation that was never captured.
 *
 * This is what "cancel the order" means before anything ships, and it is not a
 * refund: nothing was taken, so nothing comes back. Leaving the authorisation
 * alive instead holds the customer's Klarna credit line hostage for a month for
 * an order that will never exist.
 */
export async function cancelPayment(orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { orderId, provider: 'KLARNA', status: { in: ['PENDING', 'AUTHORIZED'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) return;

  try {
    if (payment.providerRef) {
      await cancelOrder(payment.providerRef);
    } else {
      const token = (payment.metadata as SessionMetadata | null)?.authorizationToken;
      if (token) await cancelAuthorization(token);
    }
  } catch (error) {
    // A failed release is worth knowing about but must not block the order
    // cancellation itself — the authorisation lapses on its own eventually.
    logger.warn('klarna.cancel_failed', {
      orderId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', errorCode: 'CANCELLED' },
  });

  await recordEvent(orderId, 'CANCELLED', 'Klarna authorisation released.', {
    data: { klarnaOrderId: payment.providerRef },
    isCustomerVisible: false,
  });
}

/**
 * Extends authorisations that are about to lapse.
 *
 * Run nightly. An authorisation that expires before the goods ship cannot be
 * captured and the revenue is gone — cheap insurance against a backorder or a
 * slow supplier quietly costing real money.
 */
export async function extendExpiringAuthorizations(withinDays = 5): Promise<number> {
  const candidates = await prisma.payment.findMany({
    where: {
      provider: 'KLARNA',
      status: 'AUTHORIZED',
      providerRef: { not: null },
      order: { status: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] } },
    },
    select: { id: true, providerRef: true, orderId: true },
    take: 200,
  });

  const cutoff = Date.now() + withinDays * 86_400_000;
  let extended = 0;

  for (const payment of candidates) {
    try {
      const { data: remote } = await readOrder(payment.providerRef!);

      if (!remote.expires_at) continue;
      if (new Date(remote.expires_at).getTime() > cutoff) continue;
      if (remote.status !== 'AUTHORIZED' && remote.status !== 'PART_CAPTURED') continue;

      await extendAuthorization(payment.providerRef!);
      extended += 1;

      await recordEvent(payment.orderId, 'NOTE_ADDED', 'Klarna authorisation extended.', {
        data: { previousExpiry: remote.expires_at },
        isCustomerVisible: false,
      });
    } catch (error) {
      logger.warn('klarna.extend_failed', {
        orderId: payment.orderId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (extended > 0) logger.info('klarna.authorizations_extended', { extended });
  return extended;
}

/**
 * The customer's own record of the purchase.
 *
 * Klarna publishes no per-order hosted receipt URL — a customer's purchases
 * live in their Klarna app and portal — so the confirmation email links there
 * and to our own order page, which is the one we control.
 */
export function klarnaPortalUrl(): string {
  return publicEnv.NEXT_PUBLIC_KLARNA_ENVIRONMENT === 'production'
    ? 'https://app.klarna.com/purchases'
    : 'https://app.playground.klarna.com/purchases';
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
