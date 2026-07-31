import 'dotenv/config';

import type Stripe from 'stripe';

import { createScriptClient } from '../prisma/client';
import { renderOrderConfirmation } from '../src/services/email.service';
import { getOrderByNumber, placeOrder } from '../src/services/order.service';
import { handleStripeEvent } from '../src/services/payment.service';

/**
 * Order and payment lifecycle, against the live database.
 *
 * Stripe's own test cards need API keys. What does *not* need keys is everything
 * those cards eventually cause: a webhook arriving with a signed event. That is
 * the only thing this system treats as authoritative, so driving
 * `handleStripeEvent` with the exact payloads Stripe sends verifies the real
 * path — order stored, status recorded, stock committed, email generated,
 * declines survived — without a network.
 *
 * What this does NOT cover: that Stripe accepts our PaymentIntent parameters and
 * that a real card clears. That needs keys and a card. See docs/checkout.md.
 *
 *   npm run verify:orders
 */
const prisma = createScriptClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The shape Stripe actually posts, trimmed to the fields the handler reads. */
function intentEvent(
  type: string,
  intent: Record<string, unknown>,
): Stripe.Event {
  return {
    id: `evt_verify_${Math.abs(Date.now() % 1_000_000)}`,
    object: 'event',
    type,
    data: { object: intent },
  } as unknown as Stripe.Event;
}

const ADDRESS = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  line1: '1 Analytical Way',
  city: 'Los Angeles',
  state: 'CA',
  postalCode: '90002',
  country: 'US',
};

async function buildCart(): Promise<{ cartId: string; variantId: string; quantity: number }> {
  const variant = await prisma.variant.findFirst({
    where: { isActive: true, deletedAt: null, inventory: { quantity: { gt: 3 } } },
    include: { inventory: true },
  });
  if (!variant) throw new Error('No stocked variant — run `npm run db:seed:catalog`.');

  const cart = await prisma.cart.create({
    data: {
      sessionToken: `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      items: { create: { variantId: variant.id, quantity: 2, unitPriceCents: variant.priceCents } },
    },
  });

  return { cartId: cart.id, variantId: variant.id, quantity: 2 };
}

async function main(): Promise<void> {
  console.log('\nOrder and payment lifecycle\n');

  const rate = await prisma.shippingRate.findFirst({ where: { code: 'standard', isActive: true } });
  if (!rate) throw new Error('No shipping rates — run `npm run db:seed:checkout`.');

  const createdOrderIds: string[] = [];

  // ---------------------------------------------------- Order is stored
  console.log('Order creation');

  const { cartId, variantId, quantity } = await buildCart();
  const before = await prisma.inventory.findUnique({ where: { variantId } });

  const order = await placeOrder({
    cartId,
    email: 'verify@example.test',
    shippingAddress: ADDRESS,
    shippingRateId: rate.id,
  });
  createdOrderIds.push(order.id);

  check('order is stored in the database', Boolean(order.id));
  check('order number follows GT-<sequence>', /^GT-\d{6,}$/.test(order.orderNumber), order.orderNumber);
  check('order starts PENDING', order.status === 'PENDING');
  check('line items are snapshotted', order.items.length === 1 && order.items[0]!.quantity === quantity);
  check(
    'item snapshot carries name, sku and price',
    Boolean(order.items[0]!.productName && order.items[0]!.sku && order.items[0]!.unitPriceCents > 0),
  );
  check('tax was quoted for a taxed state', order.taxCents > 0, `${order.taxCents}c`);
  check('tax source is recorded', Boolean(order.taxSource), String(order.taxSource));
  check(
    'total satisfies the database identity',
    order.totalCents ===
      order.subtotalCents - order.discountCents + order.shippingCents + order.taxCents,
  );

  const afterPlace = await prisma.inventory.findUnique({ where: { variantId } });
  check(
    'stock is reserved, not decremented',
    afterPlace?.reserved === (before?.reserved ?? 0) + quantity &&
      afterPlace?.quantity === before?.quantity,
  );

  const createdEvents = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
  check(
    'a CREATED event is on the timeline',
    createdEvents.some((event) => event.type === 'CREATED'),
  );

  // ------------------------------------------- Confirmation email content
  console.log('\nConfirmation email');

  const email = await renderOrderConfirmation(order.id);
  check('confirmation email is generated', Boolean(email?.html));

  if (email) {
    const money = `$${(order.totalCents / 100).toFixed(2)}`;
    check('email addresses the customer', email.to === 'verify@example.test');
    check('email states the order number', email.html.includes(order.orderNumber));
    check('email states the charged total', email.html.includes(money), `looking for ${money}`);
    check('email lists the item', email.html.includes(order.items[0]!.productName));
    check('email mentions plain packaging', /plain/i.test(email.html));

    // Discretion is a product requirement here, so it gets a real assertion.
    check(
      'subject line names no product',
      !email.subject.toLowerCase().includes(order.items[0]!.productName.toLowerCase().slice(0, 10)),
      email.subject,
    );
    check(
      'preview text names no product',
      !email.preheader.toLowerCase().includes(order.items[0]!.productName.toLowerCase().slice(0, 10)),
    );
  }

  // ------------------------------------------------------ Payment succeeds
  console.log('\nPayment succeeded (webhook)');

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'STRIPE',
      status: 'PENDING',
      amountCents: order.totalCents,
      providerRef: `pi_verify_${order.id}`,
      idempotencyKey: `order_${order.id}_intent`,
    },
  });

  await handleStripeEvent(
    intentEvent('payment_intent.succeeded', {
      id: `pi_verify_${order.id}`,
      amount: order.totalCents,
      amount_received: order.totalCents,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
    }),
  );

  const paid = await prisma.order.findUnique({
    where: { id: order.id },
    include: { events: true, payments: true },
  });

  check('order status is recorded as PAID', paid?.status === 'PAID', String(paid?.status));
  check('paidAt is stamped', Boolean(paid?.paidAt));
  check('payment status follows', paid?.paymentStatus === 'PAID');
  check('payment row is captured', paid?.payments[0]?.status === 'PAID');
  check(
    'a STATUS_CHANGED event records the transition',
    paid?.events.some((event) => event.type === 'STATUS_CHANGED') ?? false,
  );
  check(
    'a PAYMENT_SUCCEEDED event is on the timeline',
    paid?.events.some((event) => event.type === 'PAYMENT_SUCCEEDED') ?? false,
  );

  const afterPaid = await prisma.inventory.findUnique({ where: { variantId } });
  check(
    'payment commits the reservation to a real decrement',
    afterPaid?.quantity === (before?.quantity ?? 0) - quantity &&
      afterPaid?.reserved === (before?.reserved ?? 0),
  );

  // Stripe retries for three days; a replay must change nothing.
  await handleStripeEvent(
    intentEvent('payment_intent.succeeded', {
      id: `pi_verify_${order.id}`,
      amount: order.totalCents,
      amount_received: order.totalCents,
      metadata: { orderId: order.id },
    }),
  );

  const replayed = await prisma.inventory.findUnique({ where: { variantId } });
  check(
    'a replayed webhook does not double-decrement stock',
    replayed?.quantity === afterPaid?.quantity,
    `${afterPaid?.quantity} -> ${replayed?.quantity}`,
  );

  const afterReplay = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
  const successEvents = afterReplay.filter((event) => event.type === 'PAYMENT_SUCCEEDED');
  check(
    'a replayed webhook does not duplicate the timeline',
    successEvents.length === 1,
    `${successEvents.length} PAYMENT_SUCCEEDED events`,
  );

  // The same guard is what stops a retry sending a second confirmation email.
  const emailEvents = afterReplay.filter((event) => event.type === 'EMAIL_SENT');
  check(
    'a replayed webhook does not re-send the confirmation',
    emailEvents.length <= 1,
    `${emailEvents.length} EMAIL_SENT events`,
  );

  // -------------------------------------------------------- Payment fails
  console.log('\nPayment failed (webhook)');

  const second = await buildCart();
  const failing = await placeOrder({
    cartId: second.cartId,
    email: 'verify-decline@example.test',
    shippingAddress: ADDRESS,
    shippingRateId: rate.id,
  });
  createdOrderIds.push(failing.id);

  await prisma.payment.create({
    data: {
      orderId: failing.id,
      provider: 'STRIPE',
      status: 'PENDING',
      amountCents: failing.totalCents,
      providerRef: `pi_decline_${failing.id}`,
      idempotencyKey: `order_${failing.id}_intent`,
    },
  });

  const reservedBeforeDecline = await prisma.inventory.findUnique({
    where: { variantId: second.variantId },
  });

  await handleStripeEvent(
    intentEvent('payment_intent.payment_failed', {
      id: `pi_decline_${failing.id}`,
      amount: failing.totalCents,
      metadata: { orderId: failing.id },
      last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
    }),
  );

  const declined = await prisma.order.findUnique({
    where: { id: failing.id },
    include: { events: true, payments: true },
  });

  // The order must survive: the customer retries with another card.
  check('a decline leaves the order PENDING', declined?.status === 'PENDING', String(declined?.status));
  check('the payment row records the failure', declined?.payments[0]?.status === 'FAILED');
  check('the decline code is stored', declined?.payments[0]?.errorCode === 'card_declined');
  check(
    'a PAYMENT_FAILED event is on the timeline',
    declined?.events.some((event) => event.type === 'PAYMENT_FAILED') ?? false,
  );

  const reservedAfterDecline = await prisma.inventory.findUnique({
    where: { variantId: second.variantId },
  });
  check(
    'a decline keeps the stock reserved for the retry',
    reservedAfterDecline?.reserved === reservedBeforeDecline?.reserved,
  );

  // ---------------------------------------------------------- Cancellation
  console.log('\nPayment cancelled (webhook)');

  await handleStripeEvent(
    intentEvent('payment_intent.canceled', {
      id: `pi_decline_${failing.id}`,
      amount: failing.totalCents,
      metadata: { orderId: failing.id },
    }),
  );

  const cancelled = await prisma.order.findUnique({ where: { id: failing.id } });
  check('cancelling the intent cancels the order', cancelled?.status === 'CANCELLED');

  const releasedAfterCancel = await prisma.inventory.findUnique({
    where: { variantId: second.variantId },
  });
  check(
    'cancelling releases the reservation',
    releasedAfterCancel?.reserved === (reservedBeforeDecline?.reserved ?? 0) - second.quantity,
  );

  // --------------------------------------------------------------- Refund
  // Its own order, so the paid one above survives for the confirmation-page
  // check that follows this script.
  console.log('\nRefund (webhook)');

  const third = await buildCart();
  const refundable = await placeOrder({
    cartId: third.cartId,
    email: 'verify-refund@example.test',
    shippingAddress: ADDRESS,
    shippingRateId: rate.id,
  });
  createdOrderIds.push(refundable.id);

  const thirdBefore = await prisma.inventory.findUnique({ where: { variantId: third.variantId } });

  await prisma.payment.create({
    data: {
      orderId: refundable.id,
      provider: 'STRIPE',
      status: 'PENDING',
      amountCents: refundable.totalCents,
      providerRef: `pi_refund_${refundable.id}`,
      idempotencyKey: `order_${refundable.id}_intent`,
    },
  });

  await handleStripeEvent(
    intentEvent('payment_intent.succeeded', {
      id: `pi_refund_${refundable.id}`,
      amount: refundable.totalCents,
      amount_received: refundable.totalCents,
      metadata: { orderId: refundable.id },
    }),
  );

  await handleStripeEvent({
    id: 'evt_refund_verify',
    object: 'event',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_verify',
        payment_intent: `pi_refund_${refundable.id}`,
        amount: refundable.totalCents,
        amount_refunded: refundable.totalCents,
      },
    },
  } as unknown as Stripe.Event);

  const refunded = await prisma.order.findUnique({
    where: { id: refundable.id },
    include: { events: true, payments: true },
  });

  check('a full refund marks the order REFUNDED', refunded?.status === 'REFUNDED');
  check('the payment row is refunded', refunded?.payments[0]?.status === 'REFUNDED');
  check(
    'a REFUND_ISSUED event is on the timeline',
    refunded?.events.some((event) => event.type === 'REFUND_ISSUED') ?? false,
  );

  // -------------------------------------------------------- Order lookup
  console.log('\nOrder access');

  const found = await getOrderByNumber(order.orderNumber, 'verify@example.test');
  check('an order is retrievable by number plus email', found?.id === order.id);

  const wrongEmail = await getOrderByNumber(order.orderNumber, 'someone-else@example.test');
  check('the order number alone is not enough', wrongEmail === null);

  const caseInsensitive = await getOrderByNumber(order.orderNumber, 'VERIFY@EXAMPLE.TEST');
  check('email matching is case-insensitive', caseInsensitive?.id === order.id);

  // ------------------------------------------------------------- Cleanup
  console.log(`\n(leaving ${order.orderNumber} for the confirmation-page check)`);
  console.log(`ORDER_NUMBER=${order.orderNumber}`);
  console.log(`ORDER_EMAIL=verify@example.test`);

  await prisma.cart.deleteMany({ where: { sessionToken: { startsWith: 'verify-' } } });
  const keep = new Set([order.id]);
  const remove = createdOrderIds.filter((id) => !keep.has(id));

  await prisma.orderEvent.deleteMany({ where: { orderId: { in: remove } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: remove } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: remove } } });
  await prisma.order.deleteMany({ where: { id: { in: remove } } });

  // Put the catalogue back exactly as it was.
  await prisma.inventory.update({
    where: { variantId },
    data: { quantity: before?.quantity ?? 0, reserved: before?.reserved ?? 0 },
  });
  await prisma.inventory.update({
    where: { variantId: second.variantId },
    data: {
      quantity: reservedBeforeDecline?.quantity ?? 0,
      reserved: (reservedBeforeDecline?.reserved ?? 0) - second.quantity,
    },
  });
  await prisma.inventory.update({
    where: { variantId: third.variantId },
    data: { quantity: thirdBefore?.quantity ?? 0, reserved: thirdBefore?.reserved ?? 0 },
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
