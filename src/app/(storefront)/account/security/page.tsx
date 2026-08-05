import { KeyRound, MailCheck, ShieldQuestion } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PasswordForm } from '@/components/account/profile-forms';
import { SessionList } from '@/components/account/session-list';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LoginOutcome } from '@/generated/prisma/enums';
import { requireUser } from '@/server/auth/session';
import { getProfile } from '@/services/account/profile.service';
import {
  describeDevice,
  listLoginEvents,
  listSessions,
  recentFailureCount,
  twoFactorStatus,
} from '@/services/account/security.service';

export const metadata: Metadata = { title: 'Security' };

const OUTCOME_COPY: Record<
  LoginOutcome,
  { label: string; tone: 'success' | 'danger' | 'warning' }
> = {
  SUCCESS: { label: 'Signed in', tone: 'success' },
  BAD_PASSWORD: { label: 'Wrong password', tone: 'danger' },
  UNKNOWN_EMAIL: { label: 'Unknown email', tone: 'danger' },
  LOCKED: { label: 'Blocked — account not active', tone: 'warning' },
  FAILED_2FA: { label: 'Failed second factor', tone: 'danger' },
};

/**
 * The security centre.
 *
 * Everything that answers "is my account safe?" on one page: the password, where
 * you are signed in, and what has been tried against you. The last of those is
 * the one customers never think to ask for and the one that matters most — a
 * takeover is usually visible in the failures before it succeeds.
 */
export default async function SecurityPage() {
  const user = await requireUser();

  const [profile, sessions, events, failures] = await Promise.all([
    getProfile(user.id),
    listSessions(user.id),
    listLoginEvents(user.id, 10),
    recentFailureCount(user.id, 60 * 24),
  ]);

  const twoFactor = twoFactorStatus();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Security</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Your password, your devices, and recent activity on your account.
        </p>
      </header>

      {/* Surfaced only when there is something to see. A permanent "0 failed
          attempts" panel trains people to ignore the space it occupies. */}
      {failures >= 3 ? (
        <Alert variant="warning" title={`${failures} failed sign-in attempts in the last 24 hours`}>
          If none of those were you, change your password now and sign out every other device.
        </Alert>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
          <MailCheck aria-hidden="true" className="size-4 text-foreground-subtle" />
          Email verification
        </h2>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-body-sm text-foreground">{profile?.email}</p>
            <p className="text-body-xs text-foreground-subtle">
              {profile?.emailVerified
                ? `Verified on ${profile.emailVerified.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
                : 'Not verified yet — you will not be able to reset your password without it.'}
            </p>
          </div>

          {profile?.emailVerified ? (
            <Badge variant="success">Verified</Badge>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/verify-email">Send a verification link</Link>
            </Button>
          )}
        </div>
      </section>

      <PasswordForm />

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
          <KeyRound aria-hidden="true" className="size-4 text-foreground-subtle" />
          Where you are signed in
        </h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Sign out any device you do not recognise.
        </p>

        <div className="mt-5">
          <SessionList
            sessions={sessions.map((session) => ({
              id: session.id,
              device: describeDevice(session.userAgent),
              ipAddress: session.ipAddress,
              createdAt: session.createdAt,
              lastSeenAt: session.lastSeenAt,
              isCurrent: session.id === user.sessionId,
            }))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
          <ShieldQuestion aria-hidden="true" className="size-4 text-foreground-subtle" />
          Two-factor authentication
        </h2>
        <p className="mt-1 text-body-sm text-foreground-muted">{twoFactor.reason}</p>
        <p className="text-body-xs mt-3 text-foreground-subtle">
          When it arrives it will use an authenticator app rather than SMS. Text messages can be
          intercepted by taking over a phone number, which is not a theoretical risk for everybody.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-body-lg font-semibold text-foreground">Recent activity</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          The last ten attempts to sign in to your account, successful or not.
        </p>

        {events.length === 0 ? (
          <p className="mt-4 text-body-sm text-foreground-subtle">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {events.map((event) => {
              const copy = OUTCOME_COPY[event.outcome];

              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-body-sm text-foreground">
                      {describeDevice(event.userAgent)}
                    </p>
                    <p className="text-body-xs text-foreground-subtle">
                      {event.ipAddress ? `${event.ipAddress} · ` : ''}
                      {event.createdAt.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  <Badge variant={copy.tone}>{copy.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
