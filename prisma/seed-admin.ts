import 'dotenv/config';

import { createScriptClient } from './client';
import { PERMISSIONS, ROLES, ROLE_DEFINITIONS, type RoleKey } from '../src/constants/permissions';
import { hashPassword } from '../src/server/auth/password';

/**
 * Admin seed: roles, permissions, staff accounts and operational content.
 *
 *   npm run db:seed:admin
 *
 * Idempotent — upserts throughout, so running it twice changes nothing. Safe
 * to re-run after adding a permission, which is the usual reason to.
 *
 * All data is fictional. The staff accounts use `@example.test`, a reserved TLD
 * that can never receive mail, so a misconfigured mailer cannot reach a real
 * person.
 */
const prisma = createScriptClient();

const STAFF_PASSWORD = 'GoodTimeAdmin2026!';

/** One account per role, so every permission set can actually be signed into. */
const STAFF: { email: string; firstName: string; lastName: string; role: RoleKey }[] = [
  {
    email: 'owner.demo@example.test',
    firstName: 'Marguerite',
    lastName: 'Okonjo',
    role: ROLES.superAdmin,
  },
  { email: 'admin.demo@example.test', firstName: 'Tobias', lastName: 'Fenn', role: ROLES.admin },
  {
    email: 'manager.demo@example.test',
    firstName: 'Priya',
    lastName: 'Raman',
    role: ROLES.storeManager,
  },
  {
    email: 'stock.demo@example.test',
    firstName: 'Karol',
    lastName: 'Nowak',
    role: ROLES.inventoryManager,
  },
  {
    email: 'orders.demo@example.test',
    firstName: 'Dessa',
    lastName: 'Whitlock',
    role: ROLES.orderManager,
  },
  {
    email: 'support.demo@example.test',
    firstName: 'Ines',
    lastName: 'Baptiste',
    role: ROLES.customerSupport,
  },
  {
    email: 'marketing.demo@example.test',
    firstName: 'Rowan',
    lastName: 'Achebe',
    role: ROLES.marketingManager,
  },
  {
    email: 'editor.demo@example.test',
    firstName: 'Halle',
    lastName: 'Sorensen',
    role: ROLES.contentEditor,
  },
  {
    email: 'finance.demo@example.test',
    firstName: 'Yusuf',
    lastName: 'Demir',
    role: ROLES.financeManager,
  },
  {
    email: 'analyst.demo@example.test',
    firstName: 'Wren',
    lastName: 'Castellanos',
    role: ROLES.analyst,
  },
];

async function seedPermissionsAndRoles(): Promise<void> {
  console.log('Permissions and roles');

  const descriptions: Record<string, string> = Object.fromEntries(
    Object.values(PERMISSIONS).map((key) => [key, `Grants ${key.replace(':', ' ')}`]),
  );

  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: descriptions[key] ?? key },
    });
  }

  for (const [roleKey, definition] of Object.entries(ROLE_DEFINITIONS)) {
    /*
     * `set` rather than `connect`.
     *
     * A permission removed from a role's definition has to disappear from the
     * database too — `connect` would only ever add, so a grant withdrawn in
     * code would stay live in every environment that had already been seeded.
     */
    await prisma.role.upsert({
      where: { key: roleKey },
      update: {
        name: definition.name,
        description: definition.description,
        isSystem: true,
        permissions: { set: definition.permissions.map((key) => ({ key })) },
      },
      create: {
        key: roleKey,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        permissions: { connect: definition.permissions.map((key) => ({ key })) },
      },
    });

    console.log(`  ${definition.name}: ${definition.permissions.length} permissions`);
  }
}

async function seedStaff(): Promise<void> {
  console.log('\nStaff accounts');

  const passwordHash = await hashPassword(STAFF_PASSWORD);

  for (const person of STAFF) {
    const role = await prisma.role.findUnique({ where: { key: person.role } });
    if (!role) continue;

    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { firstName: person.firstName, lastName: person.lastName },
      create: {
        email: person.email,
        firstName: person.firstName,
        lastName: person.lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerified: new Date(),
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });

    // Staff are also customers of the shop they run; the CUSTOMER role is what
    // lets them use the storefront account area.
    const customerRole = await prisma.role.findUnique({ where: { key: ROLES.customer } });
    if (customerRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: customerRole.id } },
        update: {},
        create: { userId: user.id, roleId: customerRole.id },
      });
    }

    console.log(`  ${person.email} — ${ROLE_DEFINITIONS[person.role].name}`);
  }
}

async function seedContent(): Promise<void> {
  console.log('\nContent');

  const blocks = [
    {
      type: 'ANNOUNCEMENT' as const,
      title: 'Free discreet shipping over $75',
      body: 'Plain packaging, neutral sender name, always.',
      position: 0,
    },
    {
      type: 'HOME_BANNER' as const,
      title: 'The materials standard',
      body: 'Platinum-cure silicone, borosilicate glass, 316L steel. Nothing porous, ever.',
      linkUrl: '/shop',
      linkLabel: 'Shop body-safe',
      group: 'hero-secondary',
      position: 0,
    },
    {
      type: 'FAQ' as const,
      title: 'How discreet is the packaging?',
      body: 'Plain outer box, no branding, neutral sender name. The card statement shows a discreet descriptor, never a product name.',
      group: 'Shipping',
      position: 0,
    },
    {
      type: 'FAQ' as const,
      title: 'Can I return an item?',
      body: 'Unopened items within 30 days. For hygiene reasons, intimate products cannot be returned once the seal is broken — that is a health protection, not a policy preference, and it does not affect faulty items.',
      group: 'Returns',
      position: 1,
    },
    {
      type: 'FAQ' as const,
      title: 'Which lubricant works with my toy?',
      body: 'Water-based works with everything. Silicone lubricant degrades silicone toys — use it only with glass or steel.',
      group: 'Care',
      position: 2,
    },
    {
      type: 'FOOTER_LINK' as const,
      title: 'Materials standard',
      linkUrl: '/pages/materials',
      group: 'Help',
      position: 0,
    },
  ];

  for (const block of blocks) {
    const existing = await prisma.contentBlock.findFirst({
      where: { type: block.type, title: block.title },
      select: { id: true },
    });

    if (existing) {
      await prisma.contentBlock.update({ where: { id: existing.id }, data: block });
    } else {
      await prisma.contentBlock.create({ data: block });
    }
  }
  console.log(`  ${blocks.length} content blocks`);

  const menus = [
    { key: 'header', name: 'Header navigation' },
    { key: 'footer-shop', name: 'Footer — Shop' },
    { key: 'footer-help', name: 'Footer — Help' },
  ];

  for (const menu of menus) {
    await prisma.navigationMenu.upsert({
      where: { key: menu.key },
      update: { name: menu.name },
      create: menu,
    });
  }
  console.log(`  ${menus.length} navigation menus`);
}

async function seedSettings(): Promise<void> {
  console.log('\nSettings');

  const settings: { key: string; value: string; group: string }[] = [
    { key: 'store.freeShippingThresholdCents', value: '7500', group: 'store' },
    { key: 'store.lowStockThreshold', value: '5', group: 'store' },
    { key: 'store.orderPrefix', value: 'GT', group: 'store' },
    { key: 'store.supportEmail', value: 'support@intimatebunnie.example', group: 'store' },
    { key: 'store.supportHours', value: 'Mon–Fri, 9am–6pm ET', group: 'store' },
    { key: 'checkout.taxProvider', value: 'estimated', group: 'checkout' },
    { key: 'checkout.reservationMinutes', value: '30', group: 'checkout' },
    { key: 'checkout.guestCheckout', value: 'on', group: 'checkout' },
    { key: 'feature.reviews', value: 'on', group: 'features' },
    { key: 'feature.wishlist', value: 'on', group: 'features' },
    { key: 'feature.loyalty', value: 'on', group: 'features' },
    { key: 'feature.giftCards', value: 'off', group: 'features' },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, group: setting.group },
      create: setting,
    });
  }
  console.log(`  ${settings.length} settings`);
}

async function seedOperational(): Promise<void> {
  console.log('\nOperational data');

  // A stock ledger with history, so the inventory screen has something to show.
  const variants = await prisma.variant.findMany({
    take: 8,
    select: { id: true, sku: true, inventory: { select: { quantity: true } } },
  });

  const owner = await prisma.user.findUnique({ where: { email: 'owner.demo@example.test' } });

  let adjustments = 0;
  for (const [index, variant] of variants.entries()) {
    if (!variant.inventory) continue;

    const existing = await prisma.stockAdjustment.count({ where: { variantId: variant.id } });
    if (existing > 0) continue;

    await prisma.stockAdjustment.create({
      data: {
        variantId: variant.id,
        delta: variant.inventory.quantity,
        quantityAfter: variant.inventory.quantity,
        reason: 'RECEIVED',
        note: `Opening stock, delivery ${1000 + index}`,
        actorId: owner?.id ?? null,
      },
    });
    adjustments += 1;
  }
  console.log(`  ${adjustments} opening stock adjustments`);

  const redirects = [
    { source: '/vibrators', destination: '/shop/vibrators', note: 'Old flat URL' },
    { source: '/sale', destination: '/shop?sort=price_asc', note: 'Campaign shortcut' },
  ];

  for (const redirect of redirects) {
    await prisma.redirect.upsert({
      where: { source: redirect.source },
      update: {},
      create: { ...redirect, statusCode: 301, createdBy: owner?.id ?? null },
    });
  }
  console.log(`  ${redirects.length} redirects`);

  const segments = [
    {
      slug: 'high-value',
      name: 'High value',
      description: 'Spent over $500 in the last year.',
      rules: { minSpendCents: 50_000, withinDays: 365 },
    },
    {
      slug: 'lapsed',
      name: 'Lapsed',
      description: 'Ordered before, nothing in six months.',
      rules: { minOrders: 1, inactiveDays: 180 },
    },
    {
      slug: 'first-timers',
      name: 'First-time buyers',
      description: 'Exactly one order.',
      rules: { minOrders: 1, maxOrders: 1 },
    },
  ];

  for (const segment of segments) {
    await prisma.customerSegment.upsert({
      where: { slug: segment.slug },
      update: { name: segment.name, description: segment.description, rules: segment.rules },
      create: segment,
    });
  }
  console.log(`  ${segments.length} customer segments`);

  await prisma.adminAlert.upsert({
    where: { dedupeKey: 'seed:welcome' },
    update: {},
    create: {
      dedupeKey: 'seed:welcome',
      type: 'system.welcome',
      level: 'INFO',
      title: 'Admin is ready',
      body: 'Ten roles seeded, each with a demo account. Sign in as owner.demo@example.test to see everything.',
      href: '/admin/staff',
    },
  });
  console.log('  1 welcome alert');
}

async function main(): Promise<void> {
  console.log('\nSeeding the admin\n');

  await seedPermissionsAndRoles();
  await seedStaff();
  await seedContent();
  await seedSettings();
  await seedOperational();

  console.log(`\nDone. Every staff account uses the password: ${STAFF_PASSWORD}`);
  console.log('Fictional data only — @example.test can never receive mail.\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
