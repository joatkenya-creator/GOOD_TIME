import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { ADMIN_ROLES, type Permission, type RoleKey } from '@/constants/permissions';
import { ROUTES } from '@/constants/routes';
import { errors } from '@/lib/api/errors';
import { auth } from '@/lib/auth';
import { isSessionLive } from '@/services/account/security.service';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  roles: RoleKey[];
  permissions: Permission[];
  isEmailVerified: boolean;
  /** The device this request is coming from, for the security page. */
  sessionId: string | null;
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

  /*
   * Revocation, checked here because there is nowhere else it works.
   *
   * The session is a JWT, so Auth.js decodes the cookie on every read without
   * re-running its `jwt` callback — a check placed there fires only at sign-in.
   * This function is the single funnel every protected page and route handler
   * goes through, and `cache()` means the lookup happens at most once per
   * request however many times it is called.
   *
   * A primary-key lookup on a small table, measured at 0.019ms of database work.
   * Signing a device out therefore takes effect on that device's very next
   * request.
   */
  const sessionId = session.user.sessionId ?? null;
  if (sessionId && !(await isSessionLive(sessionId))) return null;

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    roles: session.user.roles ?? [],
    permissions: session.user.permissions ?? [],
    isEmailVerified: session.user.isEmailVerified ?? false,
    sessionId: session.user.sessionId ?? null,
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

  /*
   * The callback URL is always set, even when the caller did not name one.
   *
   * It doubles as a signal to the edge proxy, which sees only the JWT and so
   * still believes a revoked session is valid. Without it the proxy bounces the
   * visitor from `/sign-in` back to the page that just rejected them, and the
   * two redirect at each other until the browser gives up. Layouts and pages
   * render concurrently, so a bare `requireUser()` in a page can win the race
   * against the layout's — leaving no room for a call site to forget.
   */
  const callbackUrl = encodeURIComponent(returnTo ?? ROUTES.account.root);
  redirect(`${ROUTES.auth.signIn}?callbackUrl=${callbackUrl}`);
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
