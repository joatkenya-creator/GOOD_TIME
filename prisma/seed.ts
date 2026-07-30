import 'dotenv/config';

import { createScriptClient } from './client';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLES } from '../src/constants/permissions';

/**
 * Seed.
 *
 * Idempotent: every write is an upsert, so this can run on every deploy without
 * duplicating anything. It seeds only what the application cannot function
 * without — roles, permissions and baseline settings. No demo products; fixtures
 * belong in tests, not in a production database.
 *
 * Run with `npm run db:seed`.
 */
const prisma = createScriptClient();

const SETTINGS: { key: string; group: string; value: unknown }[] = [
  { key: 'store.currency', group: 'general', value: 'USD' },
  { key: 'store.country', group: 'general', value: 'US' },
  { key: 'store.minimumAge', group: 'compliance', value: 18 },
  { key: 'checkout.guestEnabled', group: 'checkout', value: true },
  { key: 'shipping.freeThresholdCents', group: 'shipping', value: 7500 },
  { key: 'reviews.requireModeration', group: 'reviews', value: true },
  { key: 'reviews.verifiedPurchaseOnly', group: 'reviews', value: false },
];

async function seedPermissions(): Promise<Map<string, string>> {
  const descriptions: Record<string, string> = {
    [PERMISSIONS.productRead]: 'View products in the admin',
    [PERMISSIONS.productWrite]: 'Create and edit products',
    [PERMISSIONS.productDelete]: 'Archive or delete products',
    [PERMISSIONS.orderRead]: 'View orders',
    [PERMISSIONS.orderWrite]: 'Edit and fulfil orders',
    [PERMISSIONS.orderRefund]: 'Issue refunds',
    [PERMISSIONS.customerRead]: 'View customer records',
    [PERMISSIONS.customerWrite]: 'Edit customer records',
    [PERMISSIONS.contentRead]: 'View pages and posts',
    [PERMISSIONS.contentWrite]: 'Publish pages and posts',
    [PERMISSIONS.reviewModerate]: 'Approve or reject reviews',
    [PERMISSIONS.couponWrite]: 'Create and edit coupons',
    [PERMISSIONS.importRun]: 'Run catalogue imports',
    [PERMISSIONS.settingsWrite]: 'Change store settings',
    [PERMISSIONS.analyticsRead]: 'View analytics dashboards',
    [PERMISSIONS.auditRead]: 'Read the audit log',
    [PERMISSIONS.roleAssign]: 'Assign roles to users',
  };

  const ids = new Map<string, string>();

  for (const [key, description] of Object.entries(descriptions)) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
      select: { id: true, key: true },
    });
    ids.set(permission.key, permission.id);
  }

  return ids;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const connect = definition.permissions
      .map((permission) => permissionIds.get(permission))
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));

    await prisma.role.upsert({
      where: { key },
      // `set` rather than `connect`: revoking a permission in code must actually
      // revoke it in the database on the next seed run.
      update: {
        name: definition.name,
        description: definition.description,
        permissions: { set: connect },
      },
      create: {
        key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        permissions: { connect },
      },
    });
  }
}

async function seedSettings(): Promise<void> {
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      // Existing values are left alone — an operator may have tuned them.
      update: {},
      create: { key: setting.key, group: setting.group, value: setting.value as object },
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding permissions…');
  const permissionIds = await seedPermissions();

  console.log('Seeding roles…');
  await seedRoles(permissionIds);

  console.log('Seeding settings…');
  await seedSettings();

  const counts = await Promise.all([
    prisma.permission.count(),
    prisma.role.count(),
    prisma.setting.count(),
  ]);

  console.log(
    `Done. ${counts[0]} permissions, ${counts[1]} roles, ${counts[2]} settings.\n` +
      `Grant yourself admin with: npm run grant-admin -- you@example.com ${ROLES.superAdmin}`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
