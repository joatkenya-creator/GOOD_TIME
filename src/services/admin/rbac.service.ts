import 'server-only';

import { PERMISSIONS, type Permission } from '@/constants/permissions';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * Roles and staff.
 *
 * Grants live in the database, not in the constants file. `ROLE_DEFINITIONS`
 * seeds the system roles; after that, editing a role is a data change rather
 * than a deploy, and a custom role created here is an equal citizen — nothing
 * in the authorisation path knows the difference between a seeded role and a
 * hand-made one, because everything checks capabilities rather than names.
 */

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: {
      permissions: { select: { key: true } },
      _count: { select: { users: true } },
    },
  });
}

export type RoleRow = Awaited<ReturnType<typeof listRoles>>[number];

/** Staff, meaning anyone holding a role that grants something. */
export async function listStaff() {
  return prisma.user.findMany({
    where: { roles: { some: { role: { permissions: { some: {} } } } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      lastLoginAt: true,
      roles: {
        select: {
          assignedAt: true,
          role: { select: { id: true, key: true, name: true, isSystem: true } },
          assigner: { select: { firstName: true, email: true } },
        },
      },
    },
  });
}

export type StaffRow = Awaited<ReturnType<typeof listStaff>>[number];

export async function createRole(input: {
  key: string;
  name: string;
  description?: string | null;
  permissions: Permission[];
}) {
  const key = input.key
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  if (!key) throw errors.badRequest('A role needs a key.');

  const clash = await prisma.role.findUnique({ where: { key }, select: { id: true } });
  if (clash) throw errors.badRequest(`A role with the key ${key} already exists.`);

  return prisma.role.create({
    data: {
      key,
      name: input.name,
      description: input.description || null,
      // Never a system role: only the seed creates those, and system roles
      // cannot be deleted. A custom role that marked itself undeletable would
      // be a mistake nobody could undo through the UI.
      isSystem: false,
      permissions: { connect: input.permissions.map((permission) => ({ key: permission })) },
    },
  });
}

/**
 * Replaces a role's grants.
 *
 * `set` rather than connect/disconnect: the checkbox list in the editor is the
 * complete intended state, and diffing it here would be more code reaching the
 * same result — with a window where a half-applied change is live.
 */
export async function setRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { key: true } });
  if (!role) throw errors.notFound('Role');

  /*
   * The super administrator keeps everything.
   *
   * Removing a permission from it is how an organisation locks itself out of
   * its own store — there is no second door, and no way back in through the UI.
   */
  if (role.key === 'SUPER_ADMIN') {
    throw errors.badRequest('The super administrator role cannot be reduced.');
  }

  await prisma.role.update({
    where: { id: roleId },
    data: { permissions: { set: permissions.map((permission) => ({ key: permission })) } },
  });
}

export async function deleteRole(roleId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { isSystem: true, _count: { select: { users: true } } },
  });
  if (!role) throw errors.notFound('Role');

  if (role.isSystem) throw errors.badRequest('System roles cannot be deleted.');
  if (role._count.users > 0) {
    throw errors.badRequest(
      `${role._count.users} people still hold this role. Reassign them first.`,
    );
  }

  await prisma.role.delete({ where: { id: roleId } });
}

/**
 * Assigns a role, recording who granted it.
 *
 * `assignedBy` is the point: "who gave the contractor refund access" is the
 * first question asked after something goes wrong, and it has no answer unless
 * it was written down at the moment of granting.
 */
export async function assignRole(userId: string, roleId: string, assignedBy: string): Promise<void> {
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    update: {},
    create: { userId, roleId, assignedBy },
  });
}

export async function revokeRole(userId: string, roleId: string, actorId: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { key: true } });

  /*
   * The last super administrator cannot be removed.
   *
   * Including by themselves — the most likely way this happens is someone
   * tidying up their own roles and not realising they are the only one left.
   */
  if (role?.key === 'SUPER_ADMIN') {
    const remaining = await prisma.userRole.count({ where: { roleId } });
    if (remaining <= 1) {
      throw errors.badRequest(
        'That is the last super administrator. Promote someone else before removing this one.',
      );
    }
  }

  void actorId;
  await prisma.userRole.deleteMany({ where: { userId, roleId } });
}

/** Everyone who could be made staff, for the assignment dropdown. */
export async function listAssignableUsers(limit = 50) {
  return prisma.user.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, email: true, firstName: true, lastName: true },
  });
}

/** Roles that reach the admin at all, for the "who can get in" summary. */
export function grantsAdminAccess(role: { permissions: { key: string }[] }): boolean {
  return role.permissions.some((permission) =>
    (Object.values(PERMISSIONS) as string[]).includes(permission.key),
  );
}
