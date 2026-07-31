import 'dotenv/config';

import { createScriptClient } from './client';

/**
 * Shipping rates, sales-tax rates and demo coupons.
 *
 * Unlike the catalogue seed, this one is idempotent and safe to re-run: every
 * row is upserted on a natural key. Shipping rates in particular are operational
 * data a real store needs on day one, not fixtures.
 *
 * **The tax rates below are a starting point, not a compliance position.** They
 * are combined state-level averages, which is close enough to show a plausible
 * number in the cart and nowhere near close enough to file a return on. See
 * docs/checkout.md before charging real customers.
 *
 *   npm run db:seed:checkout
 */
const prisma = createScriptClient();

const SHIPPING_RATES = [
  {
    code: 'standard',
    name: 'Standard Shipping',
    description: '5–7 business days, discreet packaging',
    type: 'FLAT' as const,
    carrier: 'USPS' as const,
    baseCents: 599,
    perKgCents: 0,
    freeWeightGrams: 0,
    // Free over $59 — set above the average order value so it pulls baskets up
    // rather than giving away shipping on orders that were placed anyway.
    freeAboveSubtotalCents: 5900,
    estimatedDaysMin: 5,
    estimatedDaysMax: 7,
    position: 1,
  },
  {
    code: 'expedited',
    name: 'Expedited Shipping',
    description: '2–3 business days',
    type: 'FLAT' as const,
    carrier: 'USPS' as const,
    baseCents: 1299,
    perKgCents: 0,
    freeWeightGrams: 0,
    freeAboveSubtotalCents: null,
    estimatedDaysMin: 2,
    estimatedDaysMax: 3,
    position: 2,
  },
  {
    code: 'overnight',
    name: 'Overnight',
    description: 'Next business day if ordered before 1pm ET',
    type: 'FLAT' as const,
    carrier: 'FEDEX' as const,
    baseCents: 2499,
    perKgCents: 0,
    freeWeightGrams: 0,
    freeAboveSubtotalCents: null,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
    position: 3,
    // Not offered to Alaska, Hawaii or Puerto Rico, where it is not actually
    // overnight and quoting it generates a refund.
    excludeStates: ['AK', 'HI', 'PR'],
  },
  {
    code: 'freight',
    name: 'Heavy / Bulk Delivery',
    description: 'For large orders. 5–8 business days.',
    type: 'WEIGHT_BASED' as const,
    carrier: 'UPS' as const,
    baseCents: 999,
    perKgCents: 450,
    // First 2kg included in the base rate.
    freeWeightGrams: 2000,
    freeAboveSubtotalCents: null,
    estimatedDaysMin: 5,
    estimatedDaysMax: 8,
    position: 4,
  },
];

/**
 * Combined average state sales-tax rates, in basis points.
 *
 * The five states absent from this list — Alaska, Delaware, Montana, New
 * Hampshire, Oregon — have no state sales tax. They are deliberately *not*
 * seeded as zero rows: an absent jurisdiction and a 0% jurisdiction mean
 * different things, and `resolveJurisdictions` returning `[]` is what tells the
 * UI to say "no sales tax" rather than "$0.00 tax".
 */
const TAX_RATES: [state: string, label: string, basisPoints: number, taxesShipping: boolean][] = [
  ['AL', 'Alabama sales tax', 922, false],
  ['AZ', 'Arizona TPT', 838, false],
  ['AR', 'Arkansas sales tax', 947, true],
  ['CA', 'California sales tax', 882, false],
  ['CO', 'Colorado sales tax', 777, false],
  ['CT', 'Connecticut sales tax', 635, true],
  ['DC', 'DC sales tax', 600, true],
  ['FL', 'Florida sales tax', 700, true],
  ['GA', 'Georgia sales tax', 738, true],
  ['HI', 'Hawaii GET', 444, true],
  ['ID', 'Idaho sales tax', 602, false],
  ['IL', 'Illinois sales tax', 888, false],
  ['IN', 'Indiana sales tax', 700, true],
  ['IA', 'Iowa sales tax', 694, false],
  ['KS', 'Kansas sales tax', 866, true],
  ['KY', 'Kentucky sales tax', 600, true],
  ['LA', 'Louisiana sales tax', 956, false],
  ['ME', 'Maine sales tax', 550, true],
  ['MD', 'Maryland sales tax', 600, false],
  ['MA', 'Massachusetts sales tax', 625, false],
  ['MI', 'Michigan sales tax', 600, true],
  ['MN', 'Minnesota sales tax', 749, true],
  ['MS', 'Mississippi sales tax', 707, true],
  ['MO', 'Missouri sales tax', 829, false],
  ['NE', 'Nebraska sales tax', 697, true],
  ['NV', 'Nevada sales tax', 823, false],
  ['NJ', 'New Jersey sales tax', 663, true],
  ['NM', 'New Mexico GRT', 778, true],
  ['NY', 'New York sales tax', 853, true],
  ['NC', 'North Carolina sales tax', 700, true],
  ['ND', 'North Dakota sales tax', 704, false],
  ['OH', 'Ohio sales tax', 725, true],
  ['OK', 'Oklahoma sales tax', 899, false],
  ['PA', 'Pennsylvania sales tax', 634, true],
  ['PR', 'Puerto Rico IVU', 1150, true],
  ['RI', 'Rhode Island sales tax', 700, true],
  ['SC', 'South Carolina sales tax', 744, true],
  ['SD', 'South Dakota sales tax', 611, true],
  ['TN', 'Tennessee sales tax', 955, true],
  ['TX', 'Texas sales tax', 820, true],
  ['UT', 'Utah sales tax', 719, false],
  ['VT', 'Vermont sales tax', 624, true],
  ['VA', 'Virginia sales tax', 577, false],
  ['WA', 'Washington sales tax', 938, true],
  ['WV', 'West Virginia sales tax', 655, true],
  ['WI', 'Wisconsin sales tax', 570, true],
  ['WY', 'Wyoming sales tax', 544, false],
];

const COUPONS = [
  {
    code: 'WELCOME10',
    description: '10% off your first order',
    type: 'PERCENTAGE' as const,
    value: 10,
    maxDiscountCents: 2500,
    minSubtotalCents: 2500,
    firstOrderOnly: true,
    usageLimitPerUser: 1,
  },
  {
    code: 'SAVE15',
    description: '$15 off orders over $75',
    type: 'FIXED_AMOUNT' as const,
    value: 1500,
    maxDiscountCents: null,
    minSubtotalCents: 7500,
    firstOrderOnly: false,
    usageLimitPerUser: null,
  },
  {
    code: 'FREESHIP',
    description: 'Free standard shipping',
    type: 'FREE_SHIPPING' as const,
    value: 0,
    maxDiscountCents: null,
    minSubtotalCents: 3500,
    firstOrderOnly: false,
    usageLimitPerUser: null,
  },
];

async function main(): Promise<void> {
  console.log('Seeding checkout configuration...\n');

  for (const rate of SHIPPING_RATES) {
    const { excludeStates, ...data } = rate as (typeof SHIPPING_RATES)[number] & {
      excludeStates?: string[];
    };

    // `states` is an allow-list, so an exclusion becomes "every state except".
    const states = excludeStates
      ? TAX_RATES.map(([code]) => code)
          .concat(['AK', 'DE', 'MT', 'NH', 'OR'])
          .filter((code) => !excludeStates.includes(code))
      : [];

    await prisma.shippingRate.upsert({
      where: { code: data.code },
      update: { ...data, states },
      create: { ...data, states, countries: ['US'] },
    });

    console.log(`  shipping  ${data.code.padEnd(12)} ${(data.baseCents / 100).toFixed(2)}`);
  }

  console.log();

  // Replace rather than upsert: `TaxRate` has no unique key to upsert on, and a
  // Postgres unique index would not dedupe these anyway — `county` and
  // `postalCode` are null on a statewide row, and NULLs are distinct from each
  // other in a unique index. Deleting only the statewide rows leaves any
  // county-level or ZIP-level overrides alone.
  await prisma.taxRate.deleteMany({ where: { country: 'US', county: null, postalCode: null } });

  await prisma.taxRate.createMany({
    data: TAX_RATES.map(([state, label, rateBasisPoints, appliesToShipping]) => ({
      country: 'US',
      state,
      // Null, not empty string: `resolveJurisdictions` matches `county: null` to
      // mean "applies to the whole state".
      county: null,
      postalCode: null,
      label,
      rateBasisPoints,
      appliesToShipping,
    })),
  });

  console.log(`  tax       ${TAX_RATES.length} state rates`);
  console.log('            AK, DE, MT, NH, OR intentionally absent (no sales tax)\n');

  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: coupon,
      create: coupon,
    });
    console.log(`  coupon    ${coupon.code.padEnd(12)} ${coupon.description}`);
  }

  console.log('\nDone.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
