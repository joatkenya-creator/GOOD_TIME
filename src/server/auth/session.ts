import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { ADMIN_ROLES, type Permission, type RoleKey } from '@/constants/permissions';
import { ROUTES } from '@/constants/routes';
import { errors } from '@/lib/api/errors';
import { auth } from '@/lib/auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  roles: RoleKey[];
  permissions: Permission[];
  isEmailVerified: boolean;
}

/**
 * Authorisation primitives.
 *
 * Two flavours, and mixing them up produces confusing failures:
 *
 *   `require*`  — for pages and layouts. Redirects the browser.
 *   `assert*`   — for route handlers and server actions. Throws an `AppError`
 *                 that the API layer turns into a 401 or 403.
 *
 * Every check is capability-based (`can(user, 'order:refund')`). Checking role
 * names at a call site is a bug: it means adding a role requires editing code.
 */

/** Request-memoised so a layout and its pages share one session read. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    roles: session.user.roles ?? [],
    permissions: session.user.permissions ?? [],
    isEmailVerified: session.user.isEmailVerified ?? false,
  };
});

export function can(user: SessionUser | null, permission: Permission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function hasRole(user: SessionUser | null, role: RoleKey): boolean {
  return Boolean(user?.roles.includes(role));
}

export function isAdmin(user: SessionUser | null): boolean {
  return Boolean(user?.roles.some((role) => ADMIN_ROLES.includes(role)));
}

// --- Page guards -----------------------------------------------------------

export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;

  const target = returnTo
    ? `${ROUTES.auth.signIn}?callbackUrl=${encodeURIComponent(returnTo)}`
    : ROUTES.auth.signIn;
  redirect(target);
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser(ROUTES.admin.root);
  if (!isAdmin(user)) redirect(ROUTES.home);
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect(ROUTES.home);
  return user;
}

// --- API guards ------------------------------------------------------------

export async function assertUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function assertPermission(permission: Permission): Promise<SessionUser> {
  const user = await assertUser();
  if (!can(user, permission)) throw errors.forbidden();
  return user;
}

export async function assertAdmin(): Promise<SessionUser> {
  const user = await assertUser();
  if (!isAdmin(user)) throw errors.forbidden();
  return user;
}
