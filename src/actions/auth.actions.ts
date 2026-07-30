'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import {
  forgotPasswordSchema,
  registerSchema,
  resetPasswordSchema,
  signInSchema,
} from '@/features/auth/schemas';
import { flattenZodError } from '@/lib/api/handler';
import { isAppError } from '@/lib/api/errors';
import { signIn } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/security/rate-limit';
import { safeRedirectPath } from '@/lib/security/sanitize';
import { registerUser, requestPasswordReset, resetPassword } from '@/services/user.service';
import { fail, ok, type Result } from '@/utils/result';

/**
 * Auth server actions.
 *
 * Actions are a thin edge: validate, rate-limit, delegate to a service, translate
 * the outcome into a `Result` the form can render. No business logic and no
 * Prisma queries live here.
 *
 * They return `Result` rather than throwing so a wrong password renders an
 * inline message instead of the error boundary.
 */

/** Rate-limit key for an unauthenticated action. Actions get no `Request` object. */
async function actionIdentity(): Promise<string> {
  const headerList = await headers();
  return headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function signInAction(
  _previous: unknown,
  formData: FormData,
): Promise<Result<{ redirectTo: string }>> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('Check the fields below.', flattenZodError(parsed.error));

  // Ten attempts per five minutes per IP: enough for a forgetful customer,
  // nowhere near enough for credential stuffing.
  const limit = rateLimit(`auth:signin:${await actionIdentity()}`, {
    limit: 10,
    windowSeconds: 300,
  });
  if (!limit.success) return fail('Too many attempts. Try again in a few minutes.');

  const redirectTo = safeRedirectPath(parsed.data.redirectTo, '/account');

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    // Never swallow Next's own control-flow signals (redirect, notFound).
    unstable_rethrow(error);
    return fail('That email and password combination is not correct.');
  }

  return ok({ redirectTo });
}

export async function registerAction(
  _previous: unknown,
  formData: FormData,
): Promise<Result<{ email: string }>> {
  const raw = Object.fromEntries(formData);
  const parsed = registerSchema.safeParse({
    ...raw,
    // Checkboxes arrive as "on" or are absent entirely.
    acceptsMarketing: raw.acceptsMarketing === 'on',
    acceptsTerms: raw.acceptsTerms === 'on',
  });

  if (!parsed.success) return fail('Check the fields below.', flattenZodError(parsed.error));

  const limit = rateLimit(`auth:register:${await actionIdentity()}`, {
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.success) return fail('Too many sign-up attempts. Try again later.');

  try {
    await registerUser(parsed.data);
    return ok({ email: parsed.data.email });
  } catch (error) {
    if (isAppError(error)) return fail(error.message);
    logger.error('Registration failed', error);
    return fail('We could not create your account. Please try again.');
  }
}

export async function forgotPasswordAction(
  _previous: unknown,
  formData: FormData,
): Promise<Result<{ sent: true }>> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('Enter a valid email address.', flattenZodError(parsed.error));

  const limit = rateLimit(`auth:forgot:${await actionIdentity()}`, {
    limit: 5,
    windowSeconds: 3600,
  });
  // Silently succeed when limited — the response must not differ from a real one.
  if (!limit.success) return ok({ sent: true });

  await requestPasswordReset(parsed.data.email);

  return ok({ sent: true });
}

export async function resetPasswordAction(
  _previous: unknown,
  formData: FormData,
): Promise<Result<{ reset: true }>> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('Check the fields below.', flattenZodError(parsed.error));

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
    return ok({ reset: true });
  } catch (error) {
    if (isAppError(error)) return fail(error.message);
    logger.error('Password reset failed', error);
    return fail('We could not reset your password. Request a new link.');
  }
}
