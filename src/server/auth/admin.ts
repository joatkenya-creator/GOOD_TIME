import 'server-only';

import { redirect } from 'next/navigation';

import { ADMIN_ENTRY_PERMISSIONS, type Permission } from '@/constants/permissions';
import { ROUTES } from '@/constants/routes';
import { errors } from '@/lib/api/errors';
import { type SessionUser, can, getSessionUser } from '@/server/auth/session';
import { type AuditEntry, recordAudit } from '@/services/admin/audit.service';

/**
 * Admin authorisation.
 *
 * Three layers, and the redundancy is the point:
 *
 *   1. `proxy.ts` blocks unauthenticated requests at the edge — fast, but it
 *      reads a JWT and so cannot see a revoked session or a changed role.
 *   2. The admin layout calls `requireAdminAccess()`, so a page added to the
 *      folder is protected before anyone remembers to protect it.
 *   3. Every page and every action names the permission it needs.
 *
 * Layer 3 is the one that matters. A single gate at the door means "can you
 * open the admin" and "can you refund $4,000" are the same question, and they
 * are not.
 */

/**
 * The front door. Any staff permission gets you in; pages gate themselves.
 *
 * Redirects rather than 404s a signed-in customer who wanders in — they are not
 * an attacker, they clicked a stale link.
 */
export async function requireAdminAccess(): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect(`${ROUTES.auth.signIn}?callbackUrl=${encodeURIComponent(ROUTES.admin.root)}`);
  }

  if (!ADMIN_ENTRY_PERMISSIONS.some((permission) => can(user, permission))) {
    redirect(ROUTES.home);
  }

  return user;
}

/**
 * A page that needs one specific capability.
 *
 * Refused staff go to `/admin/denied`, which requires nothing beyond being
 * staff. That destination matters: this used to redirect to `/admin`, and the
 * dashboard needs `analytics:read` — which customer support and content editors
 * do not hold. Every page they were refused bounced them to a page that
 * refused them again, until the browser gave up with ERR_TOO_MANY_REDIRECTS
 * and no explanation at any point.
 *
 * A redirect target that can itself refuse the visitor is a loop waiting for
 * the right role to walk into it.
 */
export async function requireAdminPermission(
  permission: Permission,
  /** Shown on the denial page so the person knows what they were refused. */
  attempted?: string,
): Promise<SessionUser> {
  const user = await requireAdminAccess();

  if (!can(user, permission)) {
    redirect(attempted ? `/admin/denied?from=${encodeURIComponent(attempted)}` : '/admin/denied');
  }

  return user;
}

/** Same, for route handlers and server actions: throws instead of redirecting. */
export async function assertAdminPermission(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw errors.unauthenticated();
  if (!can(user, permission)) throw errors.forbidden();
  return user;
}

/**
 * The wrapper every admin mutation should use.
 *
 * Checks the permission, runs the work, writes the audit row — in that order,
 * and only writing the row if the work succeeded. Three lines at each call site
 * instead of ten, and more importantly: an action written this way cannot be
 * unpermissioned or unlogged, because both are the wrapper's job rather than
 * the author's discipline.
 *
 *   const product = await withAdminAction(
 *     PERMISSIONS.productWrite,
 *     (actor) => updateProduct(id, input, actor.id),
 *     (result) => ({ action: 'UPDATE', entityType: 'Product', entityId: result.id, changes }),
 *   );
 */
export async function withAdminAction<T>(
  permission: Permission,
  work: (actor: SessionUser) => Promise<T>,
  audit: (result: T, actor: SessionUser) => Omit<AuditEntry, 'actorId'>,
): Promise<T> {
  const actor = await assertAdminPermission(permission);
  const result = await work(actor);

  await recordAudit({ ...audit(result, actor), actorId: actor.id });

  return result;
}

/**
 * Masks personal data for staff without `customer:pii`.
 *
 * A support agent needs to confirm they are talking to the right person, which
 * "j••••@gmail.com" and the last four of a phone number do. A marketing
 * manager exporting a segment needs neither. Masking in one place means the
 * decision is made once, not re-argued in every column of every table.
 */
export function maskEmail(email: string, allowed: boolean): string {
  if (allowed) return email;

  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function maskPhone(phone: string | null, allowed: boolean): string | null {
  if (!phone) return null;
  if (allowed) return phone;
  return `••• ••• ${phone.replace(/\D/g, '').slice(-4)}`;
}

/** Street address, town and postcode collapse to the region. */
export function maskAddress(
  address: { city?: string | null; state?: string | null; country?: string | null } | null,
  allowed: boolean,
): string {
  if (!address) return '—';
  if (allowed) {
    return [address.city, address.state, address.country].filter(Boolean).join(', ');
  }
  return [address.state, address.country].filter(Boolean).join(', ') || 'Hidden';
}
