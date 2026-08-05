import 'dotenv/config';

import { createScriptClient } from './client';
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLES,
} from '../src/constants/permissions';

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

/**
 * Creates every permission the application defines.
 *
 * ## Derived, never listed
 *
 * This used to hold its own hardcoded map of seventeen permissions. The
 * canonical list lives in `PERMISSION_GROUPS`, and the two drifted: phases six
 * and seven added `jobs:read`, `jobs:manage`, `import:read`, `import:rollback`,
 * `import:template`, `search:manage` and `marketing:manage` to the constants and
 * to `ROLE_DEFINITIONS`, but not here.
 *
 * The result was not a crash. `seedRoles` connects only the permissions this
 * function created, so the roles were seeded *successfully* while silently
 * missing seven grants — and `/admin/jobs`, `/admin/imports`, `/admin/search`
 * and `/admin/marketing` answered "Not permitted" to every user in the system,
 * including SUPER_ADMIN. Screens that were built, tested and documented were
 * unreachable, and nothing anywhere reported an error.
 *
 * Deriving from `PERMISSION_GROUPS` makes that class of drift impossible: a
 * permission that exists in the constants is seeded, and one that does not is
 * not a permission.
 */
async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const group of PERMISSION_GROUPS) {
    for (const definition of group.permissions) {
      const permission = await prisma.permission.upsert({
        where: { key: definition.key },
        update: { description: definition.label },
        create: { key: definition.key, description: definition.label },
        select: { id: true, key: true },
      });
      ids.set(permission.key, permission.id);
    }
  }

  /*
   * Fails loudly rather than seeding a half-configured system.
   *
   * `PERMISSIONS` is what the application checks against at runtime;
   * `PERMISSION_GROUPS` is what the admin renders and what this function
   * seeds. If a key is added to the first and not the second, the check will
   * refuse everyone forever — exactly the bug above. Better to fail the seed.
   */
  const ungrouped = (Object.values(PERMISSIONS) as string[]).filter((key) => !ids.has(key));

  if (ungrouped.length > 0) {
    throw new Error(
      `These permissions are defined in PERMISSIONS but missing from PERMISSION_GROUPS, ` +
        `so nothing would ever grant them: ${ungrouped.join(', ')}`,
    );
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
