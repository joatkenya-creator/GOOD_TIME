import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSION_GROUPS, PERMISSIONS } from '@/constants/permissions';
import { formatDate, formatDateTime } from '@/features/admin/query';
import {
  assignRoleAction,
  createRoleAction,
  deleteRoleAction,
  revokeRoleAction,
  setRolePermissionsAction,
} from '@/server/actions/admin/rbac';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listAssignableUsers, listRoles, listStaff } from '@/services/admin/rbac.service';

export const metadata: Metadata = { title: 'Staff & roles' };

/**
 * Who can do what.
 *
 * Roles are bags of capabilities, and every screen checks the capability rather
 * than the role name — so a custom role made here works everywhere immediately,
 * with no code change and nothing to redeploy.
 */
export default async function AdminStaffPage() {
  const user = await requireAdminPermission(PERMISSIONS.roleAssign);

  const [roles, staff, assignable] = await Promise.all([
    listRoles(),
    listStaff(),
    listAssignableUsers(),
  ]);

  const canManageRoles = can(user, PERMISSIONS.roleManage);

  return (
    <>
      <AdminPageHeader
        title="Staff & roles"
        description={`${staff.length} staff across ${roles.length} roles.`}
        pathname="/admin/staff"
      />

      <div className="space-y-6">
        <AdminCard title="Staff" description="Everyone holding a role that grants something">
          {staff.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              No staff accounts yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {staff.map((member) => (
                <li key={member.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">
                        {[member.firstName, member.lastName].filter(Boolean).join(' ') ||
                          member.email}
                      </p>
                      <p className="truncate text-body-xs text-foreground-subtle">
                        {member.email} · last seen{' '}
                        {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'never'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {member.roles.map((entry) => (
                        <span key={entry.role.id} className="flex items-center gap-1">
                          <StatusPill
                            label={entry.role.name}
                            tone={entry.role.key === 'SUPER_ADMIN' ? 'danger' : 'accent'}
                          />
                          <form action={revokeRoleAction}>
                            <input type="hidden" name="userId" value={member.id} />
                            <input type="hidden" name="roleId" value={entry.role.id} />
                            <button
                              type="submit"
                              aria-label={`Remove ${entry.role.name} from ${member.email}`}
                              className="rounded px-1 text-body-xs text-foreground-subtle hover:text-danger-700"
                            >
                              ×
                            </button>
                          </form>
                        </span>
                      ))}
                    </div>
                  </div>

                  {member.roles.some((entry) => entry.assigner) ? (
                    <p className="mt-1 text-body-xs text-foreground-subtle">
                      {member.roles
                        .filter((entry) => entry.assigner)
                        .map(
                          (entry) =>
                            `${entry.role.name} granted by ${entry.assigner?.firstName ?? entry.assigner?.email} on ${formatDate(entry.assignedAt)}`,
                        )
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form action={assignRoleAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <div className="min-w-0 flex-1">
              <label htmlFor="assign-user" className="mb-1.5 block text-body-xs font-medium">
                Person
              </label>
              <select
                id="assign-user"
                name="userId"
                required
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
              >
                <option value="">Choose…</option>
                {assignable.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {[candidate.firstName, candidate.lastName].filter(Boolean).join(' ') ||
                      candidate.email}{' '}
                    — {candidate.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 flex-1">
              <label htmlFor="assign-role" className="mb-1.5 block text-body-xs font-medium">
                Role
              </label>
              <select
                id="assign-role"
                name="roleId"
                required
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
              >
                <option value="">Choose…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="h-9 rounded-lg bg-accent px-4 text-body-xs font-medium text-white hover:bg-accent-hover"
            >
              Grant
            </button>
          </form>
        </AdminCard>

        {roles.map((role) => (
          <AdminCard
            key={role.id}
            title={role.name}
            description={`${role.description ?? ''} · ${role._count.users} people · ${role.permissions.length} permissions`}
            actions={
              <>
                {role.isSystem ? <StatusPill label="System" tone="neutral" /> : null}
                {canManageRoles && !role.isSystem && role._count.users === 0 ? (
                  <form action={deleteRoleAction}>
                    <input type="hidden" name="roleId" value={role.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-border px-2.5 py-1 text-body-xs text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                    >
                      Delete
                    </button>
                  </form>
                ) : null}
              </>
            }
          >
            {canManageRoles && role.key !== 'SUPER_ADMIN' ? (
              <form action={setRolePermissionsAction}>
                <input type="hidden" name="roleId" value={role.id} />

                <div className="space-y-4">
                  {PERMISSION_GROUPS.map((group) => (
                    <fieldset key={group.group}>
                      <legend className="text-body-xs font-semibold tracking-wide uppercase">
                        {group.group}
                      </legend>
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        {group.permissions.map((permission) => (
                          <label
                            key={permission.key}
                            className="flex items-start gap-2 text-body-sm"
                          >
                            <input
                              type="checkbox"
                              name="permissions"
                              value={permission.key}
                              defaultChecked={role.permissions.some(
                                (granted) => granted.key === permission.key,
                              )}
                              className="mt-0.5 size-4 rounded border-border-strong text-accent"
                            />
                            <span>
                              {permission.label}
                              {permission.hint ? (
                                <span className="block text-body-xs text-warning-700">
                                  {permission.hint}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>

                <button
                  type="submit"
                  className="mt-4 rounded-lg bg-accent px-4 py-2 text-body-sm font-medium text-white hover:bg-accent-hover"
                >
                  Save {role.name}
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {role.permissions.length === 0 ? (
                  <p className="text-body-sm text-foreground-subtle">No permissions.</p>
                ) : (
                  role.permissions.map((permission) => (
                    <StatusPill key={permission.key} label={permission.key} tone="neutral" />
                  ))
                )}
                {role.key === 'SUPER_ADMIN' ? (
                  <p className="mt-2 w-full text-body-xs text-foreground-subtle">
                    Deliberately not editable. Reducing it is how an organisation locks itself out
                    of its own store, and there is no second door.
                  </p>
                ) : null}
              </div>
            )}
          </AdminCard>
        ))}

        {canManageRoles ? (
          <AdminCard title="New role" description="Custom roles work exactly like the built-in ones.">
            <form action={createRoleAction} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="role-name" className="mb-1.5 block text-body-sm font-medium">
                    Name
                  </label>
                  <input
                    id="role-name"
                    name="name"
                    required
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  />
                </div>
                <div>
                  <label htmlFor="role-key" className="mb-1.5 block text-body-sm font-medium">
                    Key
                  </label>
                  <input
                    id="role-key"
                    name="key"
                    required
                    placeholder="WAREHOUSE_LEAD"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-body-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="role-description" className="mb-1.5 block text-body-sm font-medium">
                  Description
                </label>
                <input
                  id="role-description"
                  name="description"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <fieldset>
                <legend className="mb-2 text-body-sm font-medium">Permissions</legend>
                <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
                  {PERMISSION_GROUPS.flatMap((group) =>
                    group.permissions.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-2 text-body-sm">
                        <input
                          type="checkbox"
                          name="permissions"
                          value={permission.key}
                          className="size-4 rounded border-border-strong text-accent"
                        />
                        <span className="truncate">
                          {group.group}: {permission.label}
                        </span>
                      </label>
                    )),
                  )}
                </div>
              </fieldset>

              <button
                type="submit"
                className="rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
              >
                Create role
              </button>
            </form>
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}
