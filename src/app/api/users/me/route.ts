import { z } from 'zod';

import { readJson, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { assertUser } from '@/server/auth/session';
import { getPreferences, getProfile, updateProfile } from '@/services/account/profile.service';

/**
 * `/api/users/me` — the signed-in customer's own profile.
 *
 * The storefront uses server actions; this exists for clients that cannot call
 * one. Both route through `profile.service`, so the rules have one implementation
 * rather than two that drift.
 *
 * There is no `:id` variant and there should never be one. Identity comes from the
 * session, so "read my profile" and "read someone else's" cannot be confused.
 */
const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name').max(60),
  phone: z.string().trim().max(32).nullish(),
});

export const GET = withRoute(async () => {
  const user = await assertUser();
  const [profile, preferences] = await Promise.all([getProfile(user.id), getPreferences(user.id)]);

  return jsonOk(
    {
      id: user.id,
      email: profile?.email ?? user.email,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      phone: profile?.phone ?? null,
      image: profile?.image ?? null,
      emailVerified: profile ? profile.emailVerified !== null : user.isEmailVerified,
      acceptsMarketing: profile?.acceptsMarketing ?? false,
      memberSince: profile?.createdAt ?? null,
      roles: user.roles,
      preferences: { timezone: preferences.timezone, locale: preferences.locale },
    },
    // Personal data. Never cached, by anything.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

/**
 * Updates name and phone — deliberately nothing else.
 *
 * Changing an email address or a password requires the current password and has
 * consequences beyond the field itself (resetting verification, revoking other
 * sessions). Neither belongs in a field you can slip into a profile PATCH.
 */
export const PATCH = withRoute(async ({ request }) => {
  const user = await assertUser();
  const update = await readJson(request, profileUpdateSchema);

  await updateProfile(user.id, {
    firstName: update.firstName,
    lastName: update.lastName,
    phone: update.phone ?? null,
  });

  const profile = await getProfile(user.id);

  return jsonOk(
    {
      id: user.id,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      phone: profile?.phone ?? null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
