import 'server-only';

import type { LoginOutcome } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Sessions, sign-in history and the two-factor seam.
 *
 * ## What a session row is, and is not
 *
 * Authentication lives in a JWT — see `authConfig.session.strategy`. These rows
 * do not authenticate anyone. They exist so a customer can *see* where they are
 * signed in and revoke it, which a stateless token cannot express on its own.
 *
 * The JWT carries a session id, and **every request verifies that the row is still
 * live**, so revoking a device takes effect on its next request rather than after
 * a delay.
 *
 * That was not the first design. The original checked once a minute, to avoid "a
 * database read per request" — but measuring it showed the read costs 0.019ms of
 * database work (an index scan on the primary key) and no extra round trip on any
 * page that already queries anything. The lag was protecting against a cost that
 * did not exist, and it meant a stolen laptop kept working for a minute after the
 * owner hit "sign out everywhere". Correctness wins a trade that cheap.
 *
 * The *write* is still throttled — see `touchSession`. Activity timestamps are
 * genuinely not worth a write per request.
 */

/**
 * How often a session's `lastSeenAt` is written.
 *
 * The liveness *read* happens on every request; this throttles only the write
 * that follows it. "Last active 40 seconds ago" and "last active just now" are
 * the same answer to a customer, and one write per request is a real cost where
 * one read is not.
 */
export const SESSION_TOUCH_INTERVAL_SECONDS = 60;

export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function createSession(userId: string, context: SessionContext) {
  return prisma.userSession.create({
    data: {
      userId,
      userAgent: context.userAgent?.slice(0, 400) ?? null,
      ipAddress: context.ipAddress ?? null,
    },
    select: { id: true },
  });
}

/**
 * True when the session still exists and has not been revoked.
 *
 * Called on every authenticated request, from `getSessionUser` — **not** from the
 * Auth.js `jwt` callback, which is where it originally lived and where it silently
 * did nothing. A JWT is self-contained, so Auth.js decodes it on an ordinary read
 * and only re-runs `jwt` on sign-in or an explicit `update()`. A revocation check
 * placed there runs once, at sign-in, against a session that was just created.
 *
 * One primary-key lookup, and it doubles as the activity read: `lastSeenAt` comes
 * back in the same row, so throttling the write costs nothing extra.
 */
export async function isSessionLive(sessionId: string): Promise<boolean> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, lastSeenAt: true },
  });

  if (!session || session.revokedAt !== null) return false;

  const stale =
    Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_SECONDS * 1000;

  // Fire and forget: an activity stamp must never delay a page.
  if (stale) void touchSession(sessionId);

  return true;
}

/** Best-effort activity stamp. Never allowed to fail a request. */
export async function touchSession(sessionId: string): Promise<void> {
  await prisma.userSession
    .updateMany({ where: { id: sessionId, revokedAt: null }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
}

export async function listSessions(userId: string) {
  return prisma.userSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    take: 20,
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  logger.info('session.revoked', { userId, sessionId });
}

/**
 * Signs out every device, optionally sparing the one asking.
 *
 * Called on a password change as well as from the security page: a password is
 * changed either because it was weak or because it was exposed, and in the second
 * case leaving other sessions alive defeats the point.
 */
export async function revokeAllSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });

  logger.info('session.revoked_all', { userId, count: result.count });
  return result.count;
}

/**
 * Records a sign-in attempt.
 *
 * Never throws. A failure to write history must not turn a successful sign-in
 * into a failed one, and must not tell an attacker that their attempt was
 * unusual by behaving differently.
 */
export async function recordLogin(input: {
  email: string;
  outcome: LoginOutcome;
  userId?: string | null;
  method?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.loginEvent
    .create({
      data: {
        email: input.email.toLowerCase(),
        outcome: input.outcome,
        userId: input.userId ?? null,
        method: input.method ?? 'credentials',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
      },
    })
    .catch((error: unknown) => logger.warn('login_event.write_failed', { error }));
}

export async function listLoginEvents(userId: string, take = 10) {
  return prisma.loginEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/**
 * Recent failed attempts against an account.
 *
 * The input to a "we noticed unusual activity" notice. No rule acts on it yet —
 * lockout thresholds are a product decision, and a badly chosen one locks out
 * real customers while barely inconveniencing a botnet.
 */
export async function recentFailureCount(userId: string, withinMinutes = 60): Promise<number> {
  return prisma.loginEvent.count({
    where: {
      userId,
      outcome: { not: 'SUCCESS' },
      createdAt: { gte: new Date(Date.now() - withinMinutes * 60 * 1000) },
    },
  });
}

/**
 * Parses a user agent into something a person can recognise.
 *
 * Deliberately crude. The purpose is "is this me?", which needs "Chrome on
 * Windows", not a version number — and a full UA parsing library is a megabyte
 * of regexes maintained against a moving target.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : 'Browser';

  const platform =
    /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Linux/.test(userAgent) ? 'Linux'
    : 'Unknown';

  return `${browser} on ${platform}`;
}

/**
 * Two-factor authentication: architecture only.
 *
 * The columns are deliberately absent rather than present-and-unused. Adding
 * `twoFactorSecret` before anything writes it invites a later reader to assume it
 * is populated and trust it — a nullable secret that gates nothing is worse than
 * no column. What this seam fixes is the shape of the eventual answer:
 *
 *   1. TOTP (RFC 6238) over SMS — SMS is interceptable by SIM swap, and this
 *      store's threat model includes people whose partner controls the phone bill.
 *   2. The secret is encrypted at rest with a key outside the database, so a dump
 *      does not hand over second factors.
 *   3. Single-use recovery codes, hashed like passwords.
 *   4. `LoginOutcome.FAILED_2FA` already exists so the history can distinguish a
 *      wrong password from a wrong code.
 */
export function twoFactorStatus(): { enabled: false; available: false; reason: string } {
  return {
    enabled: false,
    available: false,
    reason: 'Two-factor authentication is not available yet.',
  };
}
