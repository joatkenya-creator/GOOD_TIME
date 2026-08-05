import { describe, expect, it } from 'vitest';

import {
  ADMIN_ENTRY_PERMISSIONS,
  ADMIN_ROLES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLES,
  type Permission,
} from '@/constants/permissions';

/**
 * The permission catalogue's internal consistency.
 *
 * ## The bug this exists to prevent
 *
 * `prisma/seed.ts` used to carry its own hardcoded list of permissions, and it
 * drifted from the constants. Seven permissions — `jobs:read`, `jobs:manage`,
 * `import:read`, `import:rollback`, `import:template`, `search:manage`,
 * `marketing:manage` — were defined in code and referenced by
 * `ROLE_DEFINITIONS`, but never created in the database.
 *
 * Nothing failed. `seedRoles` connects only the permissions that exist, so the
 * seed reported success while quietly granting seven fewer. The visible symptom
 * was four fully built admin screens answering "Not permitted" to every user
 * including SUPER_ADMIN, with no error anywhere.
 *
 * The seed now derives from `PERMISSION_GROUPS`. These tests hold the
 * invariants that made the drift possible, so the next divergence is a red
 * build rather than an inaccessible screen discovered months later.
 */

// Typed as `string`, not `Permission`, so the comparisons below can catch a key
// that is *not* a valid permission — which is the whole point of the check.
const groupedKeys = new Set<string>(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key)),
);

const declaredKeys = Object.values(PERMISSIONS) as string[];

describe('permission catalogue', () => {
  it('groups every permission the application defines', () => {
    /*
     * The invariant the seed now depends on. A key in `PERMISSIONS` that no
     * group lists is never seeded, so every check against it refuses everyone
     * forever.
     */
    const ungrouped = declaredKeys.filter((key) => !groupedKeys.has(key));

    expect(ungrouped, `not listed in PERMISSION_GROUPS: ${ungrouped.join(', ')}`).toEqual([]);
  });

  it('does not group a permission that no longer exists', () => {
    // The other direction: a stale group entry seeds a permission nothing
    // checks, which quietly grows the surface every role is granted.
    const orphaned = [...groupedKeys].filter((key) => !declaredKeys.includes(key));

    expect(orphaned, `grouped but not in PERMISSIONS: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('never lists the same permission in two groups', () => {
    // A duplicate makes the admin render it twice and makes the seed's
    // description depend on iteration order.
    const all = PERMISSION_GROUPS.flatMap((group) =>
      group.permissions.map((permission) => permission.key),
    );

    expect(all).toHaveLength(new Set(all).size);
  });

  it('gives every permission a human label', () => {
    // The label is what the seed stores as the description and what the role
    // editor shows. An empty one makes a permission unassignable in practice.
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        expect(permission.label.length, permission.key).toBeGreaterThan(3);
      }
    }
  });
});

describe('role definitions', () => {
  it('only grants permissions that exist', () => {
    const bad: string[] = [];

    for (const [role, definition] of Object.entries(ROLE_DEFINITIONS)) {
      for (const key of definition.permissions) {
        if (!declaredKeys.includes(key)) bad.push(`${role} -> ${key}`);
      }
    }

    expect(bad, `roles grant unknown permissions: ${bad.join(', ')}`).toEqual([]);
  });

  it('gives SUPER_ADMIN everything', () => {
    /*
     * Not a convenience. A super-admin who cannot reach a screen has no way to
     * grant themselves access to it either, so the capability is unreachable by
     * anyone — which is exactly how `/admin/jobs` became a dead screen.
     */
    const granted = new Set<string>(ROLE_DEFINITIONS[ROLES.superAdmin].permissions);
    const missing = declaredKeys.filter((key) => !granted.has(key));

    expect(missing, `SUPER_ADMIN cannot: ${missing.join(', ')}`).toEqual([]);
  });

  it('lets every admin role through the admin entry check', () => {
    // A role that can sign into the admin but holds no entry permission lands
    // on the denied page every time, which reads as a broken account.
    for (const role of ADMIN_ROLES) {
      const granted = new Set<Permission>(ROLE_DEFINITIONS[role].permissions);
      const canEnter = ADMIN_ENTRY_PERMISSIONS.some((key) => granted.has(key));

      expect(canEnter, `${role} can sign in to the admin but can open nothing`).toBe(true);
    }
  });
});
