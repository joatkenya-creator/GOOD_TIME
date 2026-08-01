import 'dotenv/config';

import { createScriptClient } from './client';
import { hashPassword } from '../src/server/auth/password';

/**
 * Customer account fixtures.
 *
 * Three fictional customers with the histories the account pages need to be worth
 * looking at: a regular with orders and a return, a newcomer with nothing, and a
 * lapsed one whose window to return has closed.
 *
 * Everything is invented. No name, address or email belongs to a real person, and
 * every address is a documentation-reserved example.
 *
 *   npm run db:seed:customers
 *
 * Idempotent: re-running replaces these three accounts and leaves everything else
 * alone. It refuses to touch any account not in its own list.
 */
const prisma = createScriptClient();

const PASSWORD = 'GoodTimeDemo2026!';

const CUSTOMERS = [
  {
    email: 'ada.demo@example.test',
    firstName: 'Ada',
    lastName: 'Sinclair',
    phone: '(415) 555-0142',
    timezone: 'America/Los_Angeles',
    verified: true,
    marketing: true,
    profile: 'regular',
    address: {
      line1: '2100 Sansome Street',
      line2: 'Apt 4B',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94111',
    },
  },
  {
    email: 'noor.demo@example.test',
    firstName: 'Noor',
    lastName: 'Whitfield',
    phone: '(212) 555-0188',
    timezone: 'America/New_York',
    verified: true,
    marketing: false,
    profile: 'lapsed',
    address: {
      line1: '55 Water Street',
      line2: null,
      city: 'New York',
      state: 'NY',
      postalCode: '10041',
    },
  },
  {
    email: 'sam.demo@example.test',
    firstName: 'Sam',
    lastName: 'Okonkwo',
    phone: null,
    timezone: 'America/Chicago',
    verified: false,
    marketing: false,
    profile: 'new',
    address: null,
  },
];

const DEMO_EMAILS = CUSTOMERS.map((customer) => customer.email);

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function nextOrderNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
  return `GT-${rows[0]!.nextval}`;
}

async function nextReturnNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('return_number_seq')`;
  return `RMA-${rows[0]!.nextval}`;
}

/**
 * Removes previous runs.
 *
 * Scoped to the three seeded addresses. A seed that deletes by pattern is one
 * `LIKE '%demo%'` away from removing a real customer.
 */
async function reset(): Promise<void> {
  const existing = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true },
  });

  if (existing.length === 0) return;

  const ids = existing.map((user) => user.id);
  const orders = await prisma.order.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);

  await prisma.returnItem.deleteMany({ where: { returnRequest: { userId: { in: ids } } } });
  await prisma.returnRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });

  console.log(`  reset ${existing.length} existing demo account(s)`);
}

async function main(): Promise<void> {
  console.log('\nSeeding demo customer accounts\n');

  const [variants, rate, customerRole] = await Promise.all([
    prisma.variant.findMany({
      where: { isActive: true, deletedAt: null },
      take: 8,
      include: { product: { select: { id: true, name: true } } },
    }),
    prisma.shippingRate.findFirst({ where: { code: 'standard' } }),
    prisma.role.findUnique({ where: { key: 'CUSTOMER' } }),
  ]);

  if (variants.length < 4) throw new Error('Run `npm run db:seed:catalog` first.');
  if (!rate) throw new Error('Run `npm run db:seed:checkout` first.');
  if (!customerRole) throw new Error('Run `npm run db:seed` first.');

  await reset();

  const passwordHash = await hashPassword(PASSWORD);

  for (const customer of CUSTOMERS) {
    const user = await prisma.user.create({
      data: {
        email: customer.email,
        passwordHash,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        emailVerified: customer.verified ? daysAgo(60) : null,
        acceptsMarketing: customer.marketing,
        lastLoginAt: daysAgo(1),
        roles: { create: { roleId: customerRole.id } },
        preferences: {
          create: {
            timezone: customer.timezone,
            locale: 'en-US',
            birthMonth: customer.profile === 'regular' ? 6 : null,
            birthDay: customer.profile === 'regular' ? 14 : null,
          },
        },
        rewardAccount: {
          create: {
            pointsBalance: customer.profile === 'regular' ? 420 : 0,
            storeCreditCents: customer.profile === 'regular' ? 1500 : 0,
            tier: customer.profile === 'regular' ? 'SILVER' : 'STANDARD',
          },
        },
      },
    });

    console.log(`  ${customer.email}`);

    // --- Address ---------------------------------------------------------
    let addressId: string | null = null;
    if (customer.address) {
      const address = await prisma.address.create({
        data: {
          userId: user.id,
          type: 'SHIPPING',
          isDefault: true,
          firstName: customer.firstName,
          lastName: customer.lastName,
          line1: customer.address.line1,
          line2: customer.address.line2,
          city: customer.address.city,
          state: customer.address.state,
          postalCode: customer.address.postalCode,
          country: 'US',
          phone: customer.phone,
        },
      });
      addressId = address.id;
      console.log('    address');
    }

    // --- Notification preferences ---------------------------------------
    const TOPICS = [
      'ORDER_UPDATES',
      'SHIPPING_UPDATES',
      'RETURNS',
      'SECURITY_ALERTS',
      'PROMOTIONS',
      'NEWSLETTER',
    ] as const;

    await prisma.notificationPreference.createMany({
      data: TOPICS.map((topic) => ({
        userId: user.id,
        topic,
        email:
          topic === 'PROMOTIONS' || topic === 'NEWSLETTER' ? customer.marketing : true,
        sms: false,
        push: false,
      })),
    });

    // --- Wishlist --------------------------------------------------------
    const saved = variants.slice(0, customer.profile === 'new' ? 2 : 4);
    await prisma.wishlist.create({
      data: {
        userId: user.id,
        isDefault: true,
        name: 'My Wishlist',
        items: {
          create: saved.map((variant) => ({
            productId: variant.product.id,
            variantId: variant.id,
          })),
        },
      },
    });
    console.log(`    wishlist (${saved.length})`);

    // --- Browsing history ------------------------------------------------
    await prisma.recentlyViewed.createMany({
      data: variants.slice(0, 6).map((variant, index) => ({
        userId: user.id,
        productId: variant.product.id,
        viewedAt: daysAgo(index + 1),
      })),
      skipDuplicates: true,
    });

    // --- Login history ---------------------------------------------------
    await prisma.loginEvent.createMany({
      data: [
        {
          userId: user.id,
          email: customer.email,
          outcome: 'SUCCESS',
          ipAddress: '203.0.113.24',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0',
          createdAt: daysAgo(1),
        },
        {
          userId: user.id,
          email: customer.email,
          outcome: 'BAD_PASSWORD',
          ipAddress: '198.51.100.9',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Safari/604.1',
          createdAt: daysAgo(3),
        },
        {
          userId: user.id,
          email: customer.email,
          outcome: 'SUCCESS',
          ipAddress: '203.0.113.24',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0',
          createdAt: daysAgo(12),
        },
      ],
    });

    if (customer.profile === 'new') {
      console.log('    no orders (new customer)');
      continue;
    }

    // --- Orders ----------------------------------------------------------
    const lapsed = customer.profile === 'lapsed';

    const orderSpecs = lapsed
      ? [{ ago: 95, status: 'DELIVERED' as const, lines: 2 }]
      : [
          { ago: 40, status: 'DELIVERED' as const, lines: 3 },
          { ago: 12, status: 'DELIVERED' as const, lines: 2 },
          { ago: 2, status: 'SHIPPED' as const, lines: 1 },
        ];

    const created: { id: string; number: string; itemIds: string[] }[] = [];

    for (const spec of orderSpecs) {
      const lines = variants.slice(0, spec.lines);

      const subtotal = lines.reduce(
        (sum, variant) => sum + (variant.salePriceCents ?? variant.priceCents),
        0,
      );
      const shipping = subtotal >= 5900 ? 0 : rate.baseCents;
      const tax = Math.round(subtotal * 0.0882);

      const placedAt = daysAgo(spec.ago);
      const orderNumber = await nextOrderNumber();

      const order = await prisma.order.create({
        data: {
          orderNumber,
          userId: user.id,
          email: customer.email,
          status: spec.status,
          paymentStatus: 'PAID',
          fulfillmentStatus: spec.status === 'DELIVERED' ? 'FULFILLED' : 'PARTIALLY_FULFILLED',
          subtotalCents: subtotal,
          shippingCents: shipping,
          taxCents: tax,
          totalCents: subtotal + shipping + tax,
          taxSource: 'table',
          shippingMethod: rate.name,
          shippingRateId: rate.id,
          shippingAddressId: addressId,
          shippingAddressSnapshot: customer.address
            ? {
                firstName: customer.firstName,
                lastName: customer.lastName,
                line1: customer.address.line1,
                line2: customer.address.line2,
                city: customer.address.city,
                state: customer.address.state,
                postalCode: customer.address.postalCode,
                country: 'US',
              }
            : undefined,
          placedAt,
          paidAt: placedAt,
          createdAt: placedAt,
          estimatedDeliveryAt: new Date(placedAt.getTime() + 6 * 24 * 60 * 60 * 1000),
          items: {
            create: lines.map((variant) => {
              const unit = variant.salePriceCents ?? variant.priceCents;
              return {
                variantId: variant.id,
                productName: variant.product.name,
                variantName: variant.name,
                sku: variant.sku,
                quantity: 1,
                unitPriceCents: unit,
                totalCents: unit,
              };
            }),
          },
          events: {
            create: [
              { type: 'CREATED', message: `Order ${orderNumber} placed.`, createdAt: placedAt },
              {
                type: 'PAYMENT_SUCCEEDED',
                message: 'Payment confirmed.',
                createdAt: new Date(placedAt.getTime() + 60_000),
              },
              ...(spec.status === 'DELIVERED' || spec.status === 'SHIPPED'
                ? [
                    {
                      type: 'STATUS_CHANGED' as const,
                      message: 'Order shipped.',
                      createdAt: new Date(placedAt.getTime() + 2 * 24 * 60 * 60 * 1000),
                    },
                  ]
                : []),
            ],
          },
          payments: {
            create: {
              provider: 'STRIPE',
              status: 'PAID',
              amountCents: subtotal + shipping + tax,
              providerRef: `pi_demo_${orderNumber}`,
              capturedAt: placedAt,
            },
          },
          ...(spec.status === 'SHIPPED' || spec.status === 'DELIVERED'
            ? {
                shipments: {
                  create: {
                    carrier: 'USPS' as const,
                    service: 'Ground Advantage',
                    status: spec.status === 'DELIVERED' ? ('DELIVERED' as const) : ('IN_TRANSIT' as const),
                    trackingNumber: `9400${String(Math.abs(spec.ago)).padStart(4, '0')}5551234567`,
                    shippedAt: new Date(placedAt.getTime() + 2 * 24 * 60 * 60 * 1000),
                  },
                },
              }
            : {}),
        },
        include: { items: true },
      });

      created.push({
        id: order.id,
        number: order.orderNumber,
        itemIds: order.items.map((item) => item.id),
      });
    }

    console.log(`    orders (${created.length})`);

    // --- Rewards ledger ---------------------------------------------------
    if (customer.profile === 'regular') {
      await prisma.rewardTransaction.createMany({
        data: [
          {
            userId: user.id,
            type: 'EARNED_PURCHASE',
            points: 320,
            description: `Order ${created[0]!.number}`,
            orderId: created[0]!.id,
            createdAt: daysAgo(40),
          },
          {
            userId: user.id,
            type: 'EARNED_REVIEW',
            points: 100,
            description: 'Reviewed a product',
            createdAt: daysAgo(30),
          },
          {
            userId: user.id,
            type: 'STORE_CREDIT',
            amountCents: 1500,
            description: 'Goodwill credit — delayed delivery',
            createdAt: daysAgo(20),
          },
        ],
      });
      console.log('    reward ledger (3)');
    }

    // --- A return ----------------------------------------------------------
    if (customer.profile === 'regular') {
      const target = created[1]!;
      const returnNumber = await nextReturnNumber();

      await prisma.returnRequest.create({
        data: {
          returnNumber,
          orderId: target.id,
          userId: user.id,
          status: 'APPROVED',
          reason: 'NOT_AS_DESCRIBED',
          comment: 'The size runs much smaller than the listing suggested.',
          reviewedAt: daysAgo(9),
          carrier: 'USPS',
          trackingNumber: '9400111899561234567890',
          createdAt: daysAgo(10),
          items: {
            create: { orderItemId: target.itemIds[0]!, quantity: 1, reason: 'NOT_AS_DESCRIBED' },
          },
        },
      });

      console.log(`    return ${returnNumber}`);
    }
  }

  console.log(`\nAll demo accounts share the password: ${PASSWORD}`);
  console.log('These are fictional accounts. Never seed them into production.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
