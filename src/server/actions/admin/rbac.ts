'use server';

import { revalidatePath } from 'next/cache';

import { PERMISSIONS, type Permission } from '@/constants/permissions';
import { withAdminAction } from '@/server/auth/admin';
import {
  assignRole,
  createRole,
  deleteRole,
  revokeRole,
  setRolePermissions,
} from '@/services/admin/rbac.service';

/**
 * Role and staff actions.
 *
 * The most dangerous endpoints in the admin: whoever can reach them can grant
 * themselves anything else. `role:manage` is therefore separate from
 * `role:assign` — handing out an existing role is an everyday task, editing
 * what a role means is not.
 */

function readPermissions(formData: FormData): Permission[] {
  const valid = new Set<string>(Object.values(PERMISSIONS));

  // Filtered against the catalogue, not trusted. A hand-crafted POST could
  // otherwise attach a permission string that no screen grants but some future
  // check reads.
  return formData
    .getAll('permissions')
    .map(String)
    .filter((value): value is Permission => valid.has(value));
}

export async function createRoleAction(formData: FormData): Promise<void> {
  await withAdminAction(
    PERMISSIONS.roleManage,
    () =>
      createRole({
        key: String(formData.get('key') ?? ''),
        name: String(formData.get('name') ?? '').trim(),
        description: String(formData.get('description') ?? '') || null,
        permissions: readPermissions(formData),
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'Role',
      entityId: result.id,
      changes: { key: { from: null, to: result.key }, name: { from: null, to: result.name } },
    }),
  );

  revalidatePath('/admin/staff');
}

export async function setRolePermissionsAction(formData: FormData): Promise<void> {
  const roleId = String(formData.get('roleId') ?? '');
  if (!roleId) return;

  const permissions = readPermissions(formData);

  await withAdminAction(
    PERMISSIONS.roleManage,
    () => setRolePermissions(roleId, permissions),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'Role',
      entityId: roleId,
      // The full set, not a diff: for a permission change, "what does this role
      // grant now" is the question, and reconstructing it from deltas is how
      // an audit trail becomes unreadable.
      changes: { permissions: { from: null, to: permissions } },
    }),
  );

  revalidatePath('/admin/staff');
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const roleId = String(formData.get('roleId') ?? '');
  if (!roleId) return;

  await withAdminAction(
    PERMISSIONS.roleManage,
    () => deleteRole(roleId),
    () => ({ action: 'DELETE' as const, entityType: 'Role', entityId: roleId }),
  );

  revalidatePath('/admin/staff');
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const roleId = String(formData.get('roleId') ?? '');
  if (!userId || !roleId) return;

  await withAdminAction(
    PERMISSIONS.roleAssign,
    (actor) => assignRole(userId, roleId, actor.id),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'UserRole',
      entityId: `${userId}:${roleId}`,
      changes: { granted: { from: null, to: roleId } },
    }),
  );

  revalidatePath('/admin/staff');
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const roleId = String(formData.get('roleId') ?? '');
  if (!userId || !roleId) return;

  await withAdminAction(
    PERMISSIONS.roleAssign,
    (actor) => revokeRole(userId, roleId, actor.id),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'UserRole',
      entityId: `${userId}:${roleId}`,
      changes: { revoked: { from: roleId, to: null } },
    }),
  );

  revalidatePath('/admin/staff');
}
