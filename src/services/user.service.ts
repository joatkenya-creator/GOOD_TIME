import 'server-only';

import { ROLES } from '@/constants/permissions';
import { ROUTES } from '@/constants/routes';
import { TOKEN_TTL } from '@/constants';
import { passwordChangedTemplate, passwordResetTemplate, verifyEmailTemplate } from '@/emails/auth';
import type { RegisterInput } from '@/features/auth/schemas';
import { errors } from '@/lib/api/errors';
import { sendEmail } from '@/lib/integrations/resend';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { absoluteUrl } from '@/lib/seo/url';
import { hashPassword } from '@/server/auth/password';
import { hashToken, issueToken } from '@/server/auth/tokens';

/**
 * Account lifecycle.
 *
 * Services own the business rules and are the only layer that talks to Prisma.
 * Route handlers and server actions validate input and call in here; they contain
 * no queries of their own. That boundary is what lets the future mobile API reuse
 * every rule below without duplicating it.
 */

export async function registerUser(input: RegisterInput): Promise<{ userId: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    // Deliberately explicit: the register form already reveals whether an email is
    // taken by its very nature, and a vague error here just frustrates customers.
    throw errors.conflict('An account with that email already exists.');
  }

  const customerRole = await prisma.role.findUnique({
    where: { key: ROLES.customer },
    select: { id: true },
  });

  if (!customerRole) throw errors.internal('Roles are not seeded. Run `npm run db:seed`.');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      acceptsMarketing: input.acceptsMarketing,
      roles: { create: { roleId: customerRole.id } },
    },
    select: { id: true, email: true, firstName: true },
  });

  await sendVerificationEmail(user.id);

  return { userId: user.id };
}

export async function sendVerificationEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, emailVerified: true },
  });

  if (!user || user.emailVerified) return;

  const { token, expiresAt } = issueToken(TOKEN_TTL.emailVerification);

  // Auth.js owns this table, so the adapter's own flows keep working alongside ours.
  await prisma.verificationToken.deleteMany({ where: { identifier: user.email } });
  await prisma.verificationToken.create({
    data: { identifier: user.email, token: hashToken(token), expires: expiresAt },
  });

  const url = absoluteUrl(
    `${ROUTES.auth.verifyEmail}?token=${token}&email=${encodeURIComponent(user.email)}`,
  );
  const template = verifyEmailTemplate(url, user.firstName);

  await sendEmail({ to: user.email, ...template });
}

export async function verifyEmail(email: string, token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { token: hashToken(token) },
    select: { identifier: true, expires: true },
  });

  if (!record || record.identifier !== email) throw errors.badRequest('That link is not valid.');

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token: hashToken(token) } });
    throw errors.badRequest('That link has expired. Request a new one.');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { email }, data: { emailVerified: new Date() } }),
    prisma.verificationToken.delete({ where: { token: hashToken(token) } }),
  ]);
}

/**
 * Always resolves successfully, whether or not the address exists — otherwise the
 * form becomes an account-enumeration oracle.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    logger.info('Password reset requested for unknown or inactive account', { email });
    return;
  }

  const { token, tokenHash, expiresAt } = issueToken(TOKEN_TTL.passwordReset);

  // Invalidate outstanding tokens so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const url = absoluteUrl(`${ROUTES.auth.resetPassword}?token=${token}`);
  const template = passwordResetTemplate(url, user.firstName);

  await sendEmail({ to: user.email, ...template });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, email: true, firstName: true } },
    },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw errors.badRequest('That reset link is no longer valid. Request a new one.');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.user.id }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Sign out everywhere: a password reset usually means the account was at risk.
    prisma.session.deleteMany({ where: { userId: record.user.id } }),
  ]);

  await sendEmail({ to: record.user.email, ...passwordChangedTemplate(record.user.firstName) });
}
