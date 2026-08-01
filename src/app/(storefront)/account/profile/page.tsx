import type { Metadata } from 'next';

import {
  DeleteAccountForm,
  EmailForm,
  PasswordForm,
  PreferencesForm,
  ProfileDetailsForm,
} from '@/components/account/profile-forms';
import { requireUser } from '@/server/auth/session';
import { getPreferences, getProfile } from '@/services/account/profile.service';

export const metadata: Metadata = { title: 'Profile' };

/**
 * Profile management.
 *
 * Ordered by how often it changes and how much it matters: name and phone first,
 * then email, then password, then the settings nobody edits twice — and account
 * closure last, well away from anything routine.
 */
export default async function ProfilePage() {
  const user = await requireUser();

  const [profile, preferences] = await Promise.all([getProfile(user.id), getPreferences(user.id)]);

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Profile</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Your details, how you sign in, and how things are shown to you.
        </p>
      </header>

      <ProfileDetailsForm
        firstName={profile.firstName}
        lastName={profile.lastName}
        phone={profile.phone}
      />

      <EmailForm email={profile.email} verified={profile.emailVerified !== null} />

      <PasswordForm />

      <PreferencesForm
        timezone={preferences.timezone}
        locale={preferences.locale}
        birthMonth={preferences.birthMonth}
        birthDay={preferences.birthDay}
      />

      <DeleteAccountForm />
    </div>
  );
}
