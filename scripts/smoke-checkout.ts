import 'dotenv/config';

import { createScriptClient } from '../prisma/client';
import { computeTotals } from '../src/features/checkout/totals';
import { releaseExpiredReservations } from '../src/services/order.service';

/**
 * End-to-end checkout verification against the live database.
 *
 * Every check here is one the unit tests cannot make, because it depends on real
 * rows: does the seeded tax table actually resolve, does the `orders_total_is_sum`
 * constraint actually accept what `computeTotals` produces, does the order-number
 * sequence actually hand out unique values, does reserving stock actually move
 * the numbers it should.
 *
 * Creates a real order and deletes it again. Read-only against the catalogue.
 *
 *   npm run smoke:checkout
 */
const prisma = createScriptClient();

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log('\nCheckout smoke test\n');

  // --- Configuration -----------------------------------------------------
  console.log('Configuration');

  const rates = await prisma.shippingRate.findMany({ where: { isActive: true } });
  check('shipping rates seeded', rates.length >= 3, `found ${rates.length}`);

  const standard = rates.find((rate) => rate.code === 'standard');
  check('standard rate has a free-shipping threshold', standard?.freeAboveSubtotalCents != null);

  const taxCount = await prisma.taxRate.count({ where: { isActive: true } });
  check('tax rates seeded', taxCount >= 40, `found ${taxCount}`);

  const noTaxState = await prisma.taxRate.count({ where: { state: 'OR' } });
  check('no-sales-tax states are absent, not zero rows', noTaxState === 0);

  const coupons = await prisma.coupon.count({ where: { isActive: true } });
  check('coupons seeded', coupons >= 3, `found ${coupons}`);

  // --- Tax resolution ----------------------------------------------------
  console.log('\nTax resolution');

  const caRates = await prisma.taxRate.findMany({
    where: { isActive: true, country: 'US', state: 'CA', county: null, postalCode: null },
  });
  check('California resolves to a rate', caRates.length === 1, `${caRates.length} rows`);
  check(
    'California rate is within a plausible range',
    (caRates[0]?.rateBasisPoints ?? 0) > 500 && (caRates[0]?.rateBasisPoints ?? 0) < 1200,
  );

  const orRates = await prisma.taxRate.findMany({ where: { isActive: true, state: 'OR' } });
  check('Oregon resolves to no jurisdictions at all', orRates.length === 0);

  // --- Order number sequence ---------------------------------------------
  console.log('\nOrder numbers');

  const [a] = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
  const [b] = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
  check('sequence exists and advances', Boolean(a && b && b.nextval > a.nextval));
  check('sequence starts above 100000', Number(a?.nextval ?? 0) >= 100_000);

  // --- A real order ------------------------------------------------------
  console.log('\nOrder lifecycle');

  const variant = await prisma.variant.findFirst({
    where: { isActive: true, deletedAt: null, inventory: { quantity: { gt: 5 } } },
    include: { inventory: true, product: { select: { name: true } } },
  });

  if (!variant?.inventory || !standard) {
    console.log('  SKIP  no stocked variant or shipping rate to test with');
  } else {
    const unitPriceCents = variant.salePriceCents ?? variant.priceCents;
    const quantity = 2;

    const jurisdictions = caRates.map((row) => ({
      label: row.label,
      rateBasisPoints: row.rateBasisPoints,
      appliesToShipping: row.appliesToShipping,
    }));

    const totals = computeTotals({
      lines: [{ unitPriceCents, quantity, weightGrams: variant.weightGrams ?? 0 }],
      shippingCents: standard.baseCents,
      taxJurisdictions: jurisdictions,
    });

    const orderNumber = `GT-SMOKE-${Date.now()}`;
    const startingReserved = variant.inventory.reserved;
    const startingQuantity = variant.inventory.quantity;

    // The database's own CHECK constraint is the real assertion here: if
    // `computeTotals` and `orders_total_is_sum` ever disagree, this insert fails.
    const order = await prisma.order.create({
      data: {
        orderNumber,
        email: 'smoke@example.test',
        status: 'PENDING',
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        shippingMethod: standard.name,
        shippingRateId: standard.id,
        placedAt: new Date(),
        items: {
          create: {
            variantId: variant.id,
            productName: variant.product.name,
            variantName: variant.name,
            sku: variant.sku,
            quantity,
            unitPriceCents,
            totalCents: unitPriceCents * quantity,
          },
        },
      },
      include: { items: true },
    });

    check('order accepted by orders_total_is_sum', true);
    check('tax was actually charged for a taxed state', order.taxCents > 0);
    check(
      'total equals subtotal - discount + shipping + tax',
      order.totalCents ===
        order.subtotalCents - order.discountCents + order.shippingCents + order.taxCents,
    );

    // Reservation
    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { reserved: { increment: quantity } },
    });

    const reserved = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
    check('reserving stock does not decrement quantity', reserved?.quantity === startingQuantity);
    check(
      'reserving stock increments reserved',
      reserved?.reserved === startingReserved + quantity,
    );

    // Payment: reservation becomes a decrement, exactly once.
    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { quantity: { decrement: quantity }, reserved: { decrement: quantity } },
    });

    const afterPayment = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
    check(
      'payment decrements quantity by the ordered amount',
      afterPayment?.quantity === startingQuantity - quantity,
    );
    check('payment releases the reservation', afterPayment?.reserved === startingReserved);

    await prisma.orderEvent.create({
      data: { orderId: order.id, type: 'CREATED', message: 'Smoke test order.' },
    });

    const events = await prisma.orderEvent.count({ where: { orderId: order.id } });
    check('order events are recorded', events === 1);

    // A negative total must be impossible.
    let rejected = false;
    try {
      await prisma.order.create({
        data: {
          orderNumber: `${orderNumber}-BAD`,
          email: 'smoke@example.test',
          subtotalCents: 1000,
          discountCents: 5000,
          shippingCents: 0,
          taxCents: 0,
          totalCents: -4000,
        },
      });
    } catch {
      rejected = true;
    }
    check('database rejects a discount larger than the subtotal', rejected);

    // --- Reservation expiry ----------------------------------------------
    console.log('\nReservation expiry');

    // A stale PENDING order holding stock, backdated past the window.
    const stale = await prisma.order.create({
      data: {
        orderNumber: `GT-SMOKE-STALE-${Date.now()}`,
        email: 'smoke@example.test',
        status: 'PENDING',
        subtotalCents: unitPriceCents,
        shippingCents: 0,
        taxCents: 0,
        totalCents: unitPriceCents,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        placedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        items: {
          create: {
            variantId: variant.id,
            productName: variant.product.name,
            variantName: variant.name,
            sku: variant.sku,
            quantity: 1,
            unitPriceCents,
            totalCents: unitPriceCents,
          },
        },
      },
    });

    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { reserved: { increment: 1 } },
    });

    const beforeRelease = await prisma.inventory.findUnique({ where: { variantId: variant.id } });

    const released = await releaseExpiredReservations({ olderThanMinutes: 60 });
    check('expired reservation was cancelled', released.cancelled >= 1, JSON.stringify(released));

    const staleAfter = await prisma.order.findUnique({ where: { id: stale.id } });
    check('stale order is now CANCELLED', staleAfter?.status === 'CANCELLED');

    const afterRelease = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
    check(
      'cancelling released the reservation',
      afterRelease?.reserved === (beforeRelease?.reserved ?? 0) - 1,
    );
    check(
      'cancelling did not touch sellable quantity',
      afterRelease?.quantity === beforeRelease?.quantity,
    );

    const staleEvents = await prisma.orderEvent.findMany({ where: { orderId: stale.id } });
    check(
      'cancellation is on the order timeline',
      staleEvents.some((event) => event.type === 'CANCELLED'),
    );

    // A recent PENDING order must survive the same sweep.
    const fresh = await prisma.order.create({
      data: {
        orderNumber: `GT-SMOKE-FRESH-${Date.now()}`,
        email: 'smoke@example.test',
        status: 'PENDING',
        subtotalCents: unitPriceCents,
        shippingCents: 0,
        taxCents: 0,
        totalCents: unitPriceCents,
      },
    });

    await releaseExpiredReservations({ olderThanMinutes: 60 });
    const freshAfter = await prisma.order.findUnique({ where: { id: fresh.id } });
    check('a recent PENDING order is left alone', freshAfter?.status === 'PENDING');

    // Second run must be a no-op — cron fires repeatedly.
    const secondRun = await releaseExpiredReservations({ olderThanMinutes: 60 });
    check('re-running the sweep is idempotent', secondRun.cancelled === 0);

    await prisma.orderEvent.deleteMany({ where: { orderId: { in: [stale.id, fresh.id] } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: [stale.id, fresh.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [stale.id, fresh.id] } } });

    // --- Cleanup ---------------------------------------------------------
    await prisma.orderEvent.deleteMany({ where: { orderId: order.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: 'GT-SMOKE-' } } });
    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { quantity: startingQuantity, reserved: startingReserved },
    });

    const leftover = await prisma.order.count({
      where: { orderNumber: { startsWith: 'GT-SMOKE-' } },
    });
    check('smoke data cleaned up', leftover === 0);

    const restored = await prisma.inventory.findUnique({ where: { variantId: variant.id } });
    check(
      'inventory restored',
      restored?.quantity === startingQuantity && restored?.reserved === startingReserved,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
