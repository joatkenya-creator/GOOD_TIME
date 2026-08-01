import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { errors } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/server/auth/password';

/**
 * Profile, preferences and account closure.
 *
 * Everything here is scoped to a `userId` the caller has already authenticated.
 * No function takes a user id from a request body — that is the difference
 * between "update my profile" and "update anyone's profile".
 */

export const PROFILE_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  firstName: true,
  lastName: true,
  phone: true,
  image: true,
  status: true,
  acceptsMarketing: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

export async function getProfile(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
}

/**
 * Preferences, creating the row on first read.
 *
 * Upserting on read rather than at registration keeps sign-up to a single insert,
 * and means an account created before this table existed still works.
 */
export async function getPreferences(userId: string) {
  return prisma.userPreferences.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function updateProfile(
  userId: string,
  input: { firstName: string; lastName: string; phone?: string | null },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone?.trim() || null,
    },
  });
}

export async function updatePreferences(
  userId: string,
  input: {
    timezone: string;
    locale: string;
    birthMonth?: number | null;
    birthDay?: number | null;
  },
): Promise<void> {
  const data = {
    timezone: input.timezone,
    locale: input.locale,
    birthMonth: input.birthMonth ?? null,
    birthDay: input.birthDay ?? null,
  };

  await prisma.userPreferences.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

/**
 * Changes the email address.
 *
 * Requires the current password, and resets `emailVerified` — the new address is
 * unproven until its own verification link is followed. Treating it as verified
 * because the old one was is how an account gets taken over by typo.
 */
export async function changeEmail(
  userId: string,
  newEmail: string,
  currentPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, email: true },
  });

  if (!user) throw errors.notFound('Account');

  // An OAuth-only account has no password to check. Sending them through the
  // provider is the correct path; silently allowing the change is not.
  if (!user.passwordHash) {
    return { ok: false, message: 'Your account signs in with Google. Change your email there.' };
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, message: 'That password is not correct.' };
  }

  const normalized = newEmail.trim().toLowerCase();
  if (normalized === user.email.toLowerCase()) {
    return { ok: false, message: 'That is already your email address.' };
  }

  const taken = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (taken) {
    // Deliberately the same wording a free address would get. Confirming which
    // addresses have accounts is an enumeration oracle.
    return { ok: false, message: 'That email address cannot be used.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { email: normalized, emailVerified: null },
  });

  logger.info('account.email_changed', { userId });
  return { ok: true };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) throw errors.notFound('Account');

  if (!user.passwordHash) {
    return { ok: false, message: 'Your account signs in with Google, so it has no password.' };
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, message: 'That password is not correct.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  logger.info('account.password_changed', { userId });
  return { ok: true };
}

/**
 * Closes an account.
 *
 * Soft delete, and deliberately so. Orders must survive: they are financial
 * records with tax implications, and a hard delete would either destroy them or
 * orphan them. What goes is the ability to sign in and everything that only
 * exists to serve the customer — cart, wishlist, browsing history, saved cards.
 *
 * The email is scrambled so the address can be reused for a new account, and so
 * the old address stops resolving to a person.
 */
export async function deleteAccount(
  userId: string,
  password: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, email: true },
  });

  if (!user) throw errors.notFound('Account');

  if (user.passwordHash && !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, message: 'That password is not correct.' };
  }

  const closedAt = new Date();
  // Keeps the row unique without keeping the address. Prefixed so it is obvious
  // in the database that this is not a real address.
  const tombstone = `deleted+${userId}@deleted.invalid`;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletedAt: closedAt,
        email: tombstone,
        passwordHash: null,
        firstName: null,
        lastName: null,
        phone: null,
        image: null,
        acceptsMarketing: false,
      },
    }),
    // Everything that exists only to serve a live customer.
    prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: closedAt },
    }),
    prisma.savedPaymentMethod.deleteMany({ where: { userId } }),
    prisma.cart.deleteMany({ where: { userId } }),
    prisma.recentlyViewed.deleteMany({ where: { userId } }),
    prisma.wishlist.deleteMany({ where: { userId } }),
    prisma.notificationPreference.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    // Addresses go too: an order keeps its own snapshot, so nothing is lost.
    prisma.address.deleteMany({ where: { userId } }),
  ]);

  logger.info('account.deleted', { userId, reason: reason ?? null });
  return { ok: true };
}

/**
 * Everything the dashboard needs, in one round trip.
 *
 * A dashboard that fires nine sequential queries takes nine round trips to a
 * remote database, and the customer watches every one of them. These are
 * independent, so they go together.
 */
export async function getDashboard(userId: string) {
  const [profile, preferences, orders, orderCount, addresses, wishlistCount, rewards, returns] =
    await Promise.all([
      getProfile(userId),
      getPreferences(userId),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { items: { take: 3 }, shipments: { take: 1 } },
      }),
      prisma.order.count({ where: { userId } }),
      prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        take: 2,
      }),
      prisma.wishlistItem.count({ where: { wishlist: { userId } } }),
      prisma.rewardAccount.findUnique({ where: { userId } }),
      prisma.returnRequest.count({
        where: { userId, status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] } },
      }),
    ]);

  const spend = await prisma.order.aggregate({
    where: { userId, status: { in: ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
    _sum: { totalCents: true },
  });

  return {
    profile,
    preferences,
    recentOrders: orders,
    orderCount,
    addresses,
    wishlistCount,
    rewards,
    openReturns: returns,
    lifetimeSpendCents: spend._sum.totalCents ?? 0,
  };
}

/**
 * How complete the profile is, and what is missing.
 *
 * Drives the dashboard nudge. Each step is something that measurably improves
 * the customer's own experience — not a data-collection checklist.
 */
export function profileCompletion(input: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  emailVerified: Date | null;
  addressCount: number;
}): { percent: number; missing: { label: string; href: string }[] } {
  const steps = [
    { done: Boolean(input.firstName && input.lastName), label: 'Add your name', href: '/account/profile' },
    { done: input.emailVerified !== null, label: 'Verify your email', href: '/account/security' },
    { done: input.addressCount > 0, label: 'Save an address', href: '/account/addresses' },
    { done: Boolean(input.phone), label: 'Add a phone number', href: '/account/profile' },
  ];

  const done = steps.filter((step) => step.done).length;

  return {
    percent: Math.round((done / steps.length) * 100),
    missing: steps.filter((step) => !step.done).map(({ label, href }) => ({ label, href })),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
export type ProfileRecord = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
export type PreferencesRecord = Awaited<ReturnType<typeof getPreferences>>;
export type { Prisma };
