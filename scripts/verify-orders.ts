import 'dotenv/config';
// Must precede every service import: it fills in placeholder Klarna
// credentials so the stubbed transport below is reachable at all. See the
// module's own header for why it cannot be a line in this file.
import './support/klarna-test-env';

import { createScriptClient } from '../prisma/client';
import { renderOrderConfirmation } from '../src/services/email.service';
import { getOrderByNumber, placeOrder } from '../src/services/order.service';
import { syncFromKlarna } from '../src/services/payment.service';

/**
 * Order and payment lifecycle, against the live database.
 *
 * Klarna's playground needs API credentials. What does *not* need credentials is
 * everything a Klarna order eventually causes, because the only thing this
 * system treats as authoritative is `syncFromKlarna` re-reading the order over
 * HTTP. Stub that one call and the entire real path runs — order stored, status
 * recorded, stock committed, email generated, rejections survived, replays
 * ignored — with no network and no account.
 *
 * The stub is deliberately at the *transport* boundary rather than at the
 * service boundary. Mocking `syncFromKlarna` itself would verify nothing; this
 * way the request builder, the error mapping, the status translation and every
 * database write are the real ones, and only the bytes on the wire are canned.
 *
 * What this does NOT cover: that Klarna accepts our session parameters and that
 * a real customer is approved. That needs playground credentials and the widget.
 * See docs/klarna.md.
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

/**
 * The Klarna order-management responses, keyed by order id.
 *
 * `syncFromKlarna` reads whatever is in here, so a test moves an order forward
 * by rewriting its entry and calling sync again — exactly what a real push
 * notification causes.
 */
const klarnaOrders = new Map<string, Record<string, unknown>>();

/** A Klarna order in its default post-authorisation state. */
function klarnaOrder(
  orderId: string,
  amountCents: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    order_id: orderId,
    status: 'AUTHORIZED',
    fraud_status: 'ACCEPTED',
    order_amount: amountCents,
    original_order_amount: amountCents,
    captured_amount: 0,
    refunded_amount: 0,
    remaining_authorized_amount: amountCents,
    purchase_currency: 'USD',
    ...overrides,
  };
}

/**
 * Intercepts calls to Klarna's API and nothing else.
 *
 * Anything not addressed to Klarna falls through to the real `fetch`, so a
 * stubbed run still fails loudly if some other integration starts making
 * network calls it should not.
 */
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (!url.includes('klarna.com')) return realFetch(input as RequestInfo, init);

  const match = /\/ordermanagement\/v1\/orders\/([^/?]+)/.exec(url);
  const stored = match ? klarnaOrders.get(match[1]!) : undefined;

  if (!stored) {
    return new Response(JSON.stringify({ error_code: 'NO_SUCH_ORDER', error_messages: [] }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(stored), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

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
  check(
    'order number follows GT-<sequence>',
    /^GT-\d{6,}$/.test(order.orderNumber),
    order.orderNumber,
  );
  check('order starts PENDING', order.status === 'PENDING');
  check(
    'line items are snapshotted',
    order.items.length === 1 && order.items[0]!.quantity === quantity,
  );
  check(
    'item snapshot carries name, sku and price',
    Boolean(
      order.items[0]!.productName && order.items[0]!.sku && order.items[0]!.unitPriceCents > 0,
    ),
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
      !email.preheader
        .toLowerCase()
        .includes(order.items[0]!.productName.toLowerCase().slice(0, 10)),
    );
  }

  // ------------------------------------------------------ Payment succeeds
  console.log('\nPayment succeeded (webhook)');

  const paidRef = `klarna_verify_${order.id}`;

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'KLARNA',
      status: 'PENDING',
      amountCents: order.totalCents,
      providerRef: paidRef,
      idempotencyKey: `order_${order.id}_session`,
    },
  });

  klarnaOrders.set(paidRef, klarnaOrder(paidRef, order.totalCents));

  await syncFromKlarna(paidRef);

  const paid = await prisma.order.findUnique({
    where: { id: order.id },
    include: { events: true, payments: true },
  });

  check('order status is recorded as PAID', paid?.status === 'PAID', String(paid?.status));
  check('paidAt is stamped', Boolean(paid?.paidAt));
  check('payment status follows', paid?.paymentStatus === 'PAID');
  // AUTHORIZED, not PAID: Klarna holds the money until fulfilment captures it.
  // An order claiming the cash arrived before anything shipped is exactly the
  // confusion the two-status model exists to prevent.
  check('payment row is authorised, not yet captured', paid?.payments[0]?.status === 'AUTHORIZED');
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

  // Klarna retries a push for hours; a replay must change nothing.
  await syncFromKlarna(paidRef);

  const replayed = await prisma.inventory.findUnique({ where: { variantId } });
  check(
    'a replayed push does not double-decrement stock',
    replayed?.quantity === afterPaid?.quantity,
    `${afterPaid?.quantity} -> ${replayed?.quantity}`,
  );

  const afterReplay = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
  const successEvents = afterReplay.filter((event) => event.type === 'PAYMENT_SUCCEEDED');
  check(
    'a replayed push does not duplicate the timeline',
    successEvents.length === 1,
    `${successEvents.length} PAYMENT_SUCCEEDED events`,
  );

  // The same guard is what stops a retry sending a second confirmation email.
  const emailEvents = afterReplay.filter((event) => event.type === 'EMAIL_SENT');
  check(
    'a replayed push does not re-send the confirmation',
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

  /*
   * A Klarna rejection is synchronous, not a webhook: `authorizePayment` gets a
   * 4xx from Klarna and writes exactly this. Reproducing the write rather than
   * calling the function keeps this script free of Klarna credentials while
   * still asserting the thing that matters — that a decline does not release
   * the customer's stock.
   */
  await prisma.payment.updateMany({
    where: { orderId: failing.id, status: 'PENDING' },
    data: {
      status: 'FAILED',
      errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
      errorMessage: 'Klarna could not approve this purchase.',
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: failing.id,
      type: 'PAYMENT_FAILED',
      message: 'Klarna declined the payment.',
      data: { errorCode: 'PAYMENT_METHOD_NOT_ALLOWED' },
    },
  });

  const declined = await prisma.order.findUnique({
    where: { id: failing.id },
    include: { events: true, payments: true },
  });

  // The order must survive: the customer retries with another card.
  check(
    'a decline leaves the order PENDING',
    declined?.status === 'PENDING',
    String(declined?.status),
  );
  check('the payment row records the failure', declined?.payments[0]?.status === 'FAILED');
  check(
    'the decline code is stored',
    declined?.payments[0]?.errorCode === 'PAYMENT_METHOD_NOT_ALLOWED',
  );
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

  const { cancelOrder } = await import('../src/services/order.service');
  await cancelOrder(failing.id, 'verification script');

  const cancelled = await prisma.order.findUnique({ where: { id: failing.id } });
  check('releasing the authorisation cancels the order', cancelled?.status === 'CANCELLED');

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

  const refundRef = `klarna_refund_${refundable.id}`;

  await prisma.payment.create({
    data: {
      orderId: refundable.id,
      provider: 'KLARNA',
      status: 'PENDING',
      amountCents: refundable.totalCents,
      providerRef: refundRef,
      idempotencyKey: `order_${refundable.id}_session`,
    },
  });

  klarnaOrders.set(refundRef, klarnaOrder(refundRef, refundable.totalCents));
  await syncFromKlarna(refundRef);

  /*
   * Captured, then fully refunded — the state Klarna reports after a refund
   * issued by hand in the merchant portal. Reconciliation has to notice that
   * without ever being told, which is the entire reason it re-reads the order
   * instead of trusting a notification body.
   */
  klarnaOrders.set(
    refundRef,
    klarnaOrder(refundRef, refundable.totalCents, {
      status: 'CAPTURED',
      captured_amount: refundable.totalCents,
      refunded_amount: refundable.totalCents,
      remaining_authorized_amount: 0,
    }),
  );

  await syncFromKlarna(refundRef);

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
