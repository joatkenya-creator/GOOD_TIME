'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROUTES } from '@/constants/routes';
import {
  deleteAccountSchema,
  emailChangeSchema,
  passwordChangeSchema,
  preferencesSchema,
  profileSchema,
  savedAddressSchema,
  type SavedAddressInput,
} from '@/features/account/schemas';
import { isAppError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { signOut } from '@/lib/auth';
import { requireUser } from '@/server/auth/session';
import * as addresses from '@/services/account/address.service';
import * as notifications from '@/services/account/notification.service';
import * as profile from '@/services/account/profile.service';
import * as security from '@/services/account/security.service';
import {
  sendPasswordChangedEmail,
  sendPreferencesUpdatedEmail,
  sendProfileUpdatedEmail,
} from '@/services/email.service';

/**
 * Account server actions.
 *
 * Every one starts with `requireUser()`. No action accepts a user id — the
 * identity always comes from the session, never from the caller, which is the
 * difference between "update my profile" and "update anyone's profile".
 *
 * Results are returned rather than thrown: a thrown error in a form action shows
 * a Next.js overlay in development and a blank failure in production, while a
 * returned message shows the customer what went wrong.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

function fail(error: unknown): ActionResult {
  if (isAppError(error)) return { ok: false, message: error.message };
  logger.error('account.action_failed', error);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
  }
  return { ok: false, message: 'Please check the highlighted fields.', fieldErrors };
}

// --------------------------------------------------------------------- profile

export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    phone: formData.get('phone') ?? '',
  });

  if (!parsed.success) return invalid(parsed.error);

  try {
    await profile.updateProfile(user.id, parsed.data);
    revalidatePath('/account', 'layout');

    // Deliberately not awaited on the critical path of the reply, but still
    // awaited before returning: a serverless function that returns early gets
    // frozen mid-send.
    await sendProfileUpdatedEmail(user.id, ['name', 'phone']);

    return { ok: true, message: 'Profile updated.' };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePreferencesAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const raw = {
    timezone: formData.get('timezone'),
    locale: formData.get('locale') ?? 'en-US',
    birthMonth: formData.get('birthMonth') || null,
    birthDay: formData.get('birthDay') || null,
  };

  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await profile.updatePreferences(user.id, parsed.data);
    revalidatePath('/account', 'layout');
    return { ok: true, message: 'Preferences saved.' };
  } catch (error) {
    return fail(error);
  }
}

export async function changeEmailAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = emailChangeSchema.safeParse({
    email: formData.get('email'),
    currentPassword: formData.get('currentPassword'),
  });

  if (!parsed.success) return invalid(parsed.error);

  try {
    const result = await profile.changeEmail(user.id, parsed.data.email, parsed.data.currentPassword);
    if (!result.ok) return result;

    revalidatePath('/account', 'layout');
    return {
      ok: true,
      message: 'Email updated. Check the new address for a verification link.',
    };
  } catch (error) {
    return fail(error);
  }
}

// -------------------------------------------------------------------- security

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = passwordChangeSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) return invalid(parsed.error);

  try {
    const result = await profile.changePassword(
      user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    if (!result.ok) return result;

    // A password is changed either because it was weak or because it was
    // exposed. In the second case, leaving other devices signed in defeats the
    // point — so they all go, except the one doing the changing.
    const revoked = await security.revokeAllSessions(user.id, user.sessionId ?? undefined);
    await sendPasswordChangedEmail(user.id);

    revalidatePath('/account/security');

    return {
      ok: true,
      message:
        revoked > 0
          ? `Password changed. ${revoked} other ${revoked === 1 ? 'device was' : 'devices were'} signed out.`
          : 'Password changed.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await security.revokeSession(user.id, sessionId);
    revalidatePath('/account/security');

    // Revoking the device you are reading this on is a sign-out, and pretending
    // otherwise leaves the customer on a page that stops working a minute later.
    if (sessionId === user.sessionId) await signOut({ redirectTo: ROUTES.home });

    return { ok: true, message: 'That device was signed out.' };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    const count = await security.revokeAllSessions(user.id, user.sessionId ?? undefined);
    revalidatePath('/account/security');

    return {
      ok: true,
      message: count === 0 ? 'No other devices were signed in.' : `Signed out ${count} other ${count === 1 ? 'device' : 'devices'}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// -------------------------------------------------------------------- addresses

function readAddress(formData: FormData): unknown {
  return {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    company: formData.get('company') ?? '',
    line1: formData.get('line1'),
    line2: formData.get('line2') ?? '',
    city: formData.get('city'),
    state: formData.get('state'),
    postalCode: formData.get('postalCode'),
    country: 'US',
    phone: formData.get('phone') ?? '',
    type: formData.get('type') ?? 'SHIPPING',
    isDefault: formData.get('isDefault') === 'on' || formData.get('isDefault') === 'true',
  };
}

export async function saveAddressAction(
  addressId: string | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = savedAddressSchema.safeParse(readAddress(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const input = parsed.data as SavedAddressInput;

    if (addressId) await addresses.updateAddress(user.id, addressId, input);
    else await addresses.createAddress(user.id, input);

    revalidatePath('/account/addresses');
    revalidatePath('/account');

    return { ok: true, message: addressId ? 'Address updated.' : 'Address saved.' };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteAddressAction(addressId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await addresses.deleteAddress(user.id, addressId);
    revalidatePath('/account/addresses');
    revalidatePath('/account');
    return { ok: true, message: 'Address removed.' };
  } catch (error) {
    return fail(error);
  }
}

export async function setDefaultAddressAction(addressId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await addresses.setDefaultAddress(user.id, addressId);
    revalidatePath('/account/addresses');
    return { ok: true, message: 'Default address updated.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------- notifications

export async function saveNotificationPreferencesAction(
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    const current = await notifications.getPreferences(user.id);

    // An unchecked box submits nothing, so the stored list is the source of
    // topics and the form only says which are on.
    await notifications.setPreferences(
      user.id,
      current.map((preference) => ({
        topic: preference.topic,
        email: formData.get(`${preference.topic}.email`) === 'on',
        sms: formData.get(`${preference.topic}.sms`) === 'on',
        push: formData.get(`${preference.topic}.push`) === 'on',
      })),
    );

    await sendPreferencesUpdatedEmail(user.id);
    revalidatePath('/account/notifications');

    return { ok: true, message: 'Notification preferences saved.' };
  } catch (error) {
    return fail(error);
  }
}

export async function unsubscribeAllAction(): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await notifications.unsubscribeFromMarketing(user.id);
    revalidatePath('/account/notifications');
    return { ok: true, message: 'You have been unsubscribed from all marketing.' };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------- closure

export async function deleteAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = deleteAccountSchema.safeParse({
    confirmation: formData.get('confirmation'),
    password: formData.get('password'),
    reason: formData.get('reason') ?? '',
  });

  if (!parsed.success) return invalid(parsed.error);

  try {
    const result = await profile.deleteAccount(user.id, parsed.data.password, parsed.data.reason);
    if (!result.ok) return result;
  } catch (error) {
    return fail(error);
  }

  // Outside the try: `signOut` redirects by throwing, and catching that would
  // turn a completed closure into an error message.
  await signOut({ redirectTo: ROUTES.home });
  redirect(ROUTES.home);
}
