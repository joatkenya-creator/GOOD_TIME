'use client';

import { AlertTriangle, Mail, ShieldAlert, User } from 'lucide-react';
import { useActionState, useId, useState } from 'react';

import { CheckboxField, Field } from '@/components/checkout/address-fields';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { passwordStrength } from '@/features/account/schemas';
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  updatePreferencesAction,
  updateProfileAction,
  type ActionResult,
} from '@/server/actions/account';
import { cn } from '@/utils/cn';

/**
 * Profile forms.
 *
 * Each is its own `<form>` with its own submit and its own result, rather than
 * one form saving everything. Changing a phone number and changing a password are
 * different acts with different risk, and a single Save button that does both
 * makes the safe change feel as consequential as the dangerous one.
 *
 * `useActionState` keeps the pending state and the server's reply on the form
 * itself, so nothing needs a toast to tell the customer what happened.
 */

const EMPTY: ActionResult = { ok: false, message: '' };

/** Shared result banner. Errors are assertive; successes are polite. */
function Result({ result }: { result: ActionResult }) {
  if (!result.message) return null;

  return (
    <div role={result.ok ? 'status' : 'alert'} className="mt-4">
      <Alert variant={result.ok ? 'success' : 'danger'}>{result.message}</Alert>
    </div>
  );
}

function Panel({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
        {icon ? <span className="text-foreground-subtle">{icon}</span> : null}
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-body-sm text-foreground-muted">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function ProfileDetailsForm({
  firstName,
  lastName,
  phone,
}: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}) {
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => updateProfileAction(formData),
    EMPTY,
  );

  return (
    <Panel title="Your details" icon={<User aria-hidden="true" className="size-4" />}>
      <form action={action} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="firstName"
            name="firstName"
            label="First name"
            autoComplete="given-name"
            defaultValue={firstName ?? ''}
            error={result.fieldErrors?.firstName?.[0]}
          />
          <Field
            id="lastName"
            name="lastName"
            label="Last name"
            autoComplete="family-name"
            defaultValue={lastName ?? ''}
            error={result.fieldErrors?.lastName?.[0]}
          />
        </div>

        <Field
          id="phone"
          name="phone"
          label="Phone"
          optional
          type="tel"
          autoComplete="tel"
          hint="Only used if there is a problem with a delivery."
          defaultValue={phone ?? ''}
          error={result.fieldErrors?.phone?.[0]}
        />

        <Button type="submit" isLoading={pending}>
          Save changes
        </Button>
      </form>

      <Result result={result} />
    </Panel>
  );
}

export function EmailForm({ email, verified }: { email: string; verified: boolean }) {
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => changeEmailAction(formData),
    EMPTY,
  );

  return (
    <Panel
      title="Email address"
      description="Where receipts, tracking and security notices go."
      icon={<Mail aria-hidden="true" className="size-4" />}
    >
      {!verified ? (
        <Alert variant="warning" title="This address is not verified" className="mb-5">
          Verify it so you can recover your account if you forget your password.
        </Alert>
      ) : null}

      <form action={action} noValidate className="space-y-4">
        <Field
          id="email"
          name="email"
          type="email"
          label="Email address"
          autoComplete="email"
          defaultValue={email}
          error={result.fieldErrors?.email?.[0]}
        />

        <Field
          id="emailCurrentPassword"
          name="currentPassword"
          type="password"
          label="Current password"
          autoComplete="current-password"
          hint="Required — your email address is how an account gets recovered."
          error={result.fieldErrors?.currentPassword?.[0]}
        />

        <Button type="submit" variant="secondary" isLoading={pending}>
          Update email
        </Button>
      </form>

      <Result result={result} />
    </Panel>
  );
}

/**
 * Password change, with a live strength meter.
 *
 * The meter never blocks a submission — it nudges. A rule that rejects a
 * passphrase for lacking a symbol trains people to append `!`, which buys
 * nothing.
 */
export function PasswordForm() {
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => changePasswordAction(formData),
    EMPTY,
  );

  const [password, setPassword] = useState('');
  const strength = passwordStrength(password);
  const meterId = useId();

  const BAR = ['bg-danger-500', 'bg-danger-500', 'bg-warning-500', 'bg-success-500', 'bg-success-500'];

  return (
    <Panel
      title="Password"
      description="Changing it signs out every other device."
      icon={<ShieldAlert aria-hidden="true" className="size-4" />}
    >
      <form action={action} noValidate className="space-y-4">
        <Field
          id="currentPassword"
          name="currentPassword"
          type="password"
          label="Current password"
          autoComplete="current-password"
          error={result.fieldErrors?.currentPassword?.[0]}
        />

        <div>
          <Field
            id="newPassword"
            name="newPassword"
            type="password"
            label="New password"
            autoComplete="new-password"
            aria-describedby={meterId}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={result.fieldErrors?.newPassword?.[0]}
          />

          {password ? (
            <div id={meterId} className="mt-2">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      index < strength.score ? BAR[strength.score] : 'bg-border',
                    )}
                  />
                ))}
              </div>
              {/* The text carries the meaning; the bars are decoration. */}
              <p aria-live="polite" className="mt-1.5 text-body-xs text-foreground-muted">
                <span className="font-medium text-foreground">{strength.label}.</span>{' '}
                {strength.hint}
              </p>
            </div>
          ) : null}
        </div>

        <Field
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          error={result.fieldErrors?.confirmPassword?.[0]}
        />

        <Button type="submit" isLoading={pending}>
          Change password
        </Button>
      </form>

      <Result result={result} />
    </Panel>
  );
}

export function PreferencesForm({
  timezone,
  locale,
  birthMonth,
  birthDay,
}: {
  timezone: string;
  locale: string;
  birthMonth: number | null;
  birthDay: number | null;
}) {
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => updatePreferencesAction(formData),
    EMPTY,
  );

  // From the browser rather than a hardcoded list, so it never goes stale. Falls
  // back to a short list where `supportedValuesOf` is unavailable.
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone').filter((zone) => zone.startsWith('America/'))
      : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  return (
    <Panel
      title="Regional settings"
      description="How dates and times are shown to you."
    >
      <form action={action} noValidate className="space-y-4">
        <div>
          <label htmlFor="timezone" className="mb-1.5 block text-body-sm font-medium text-foreground">
            Time zone
          </label>
          <Select id="timezone" name="timezone" defaultValue={timezone}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace('America/', '').replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="locale" className="mb-1.5 block text-body-sm font-medium text-foreground">
            Language
          </label>
          <Select id="locale" name="locale" defaultValue={locale}>
            <option value="en-US">English (US)</option>
          </Select>
          <p className="mt-1 text-body-xs text-foreground-subtle">
            More languages are on the way.
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-body-sm font-medium text-foreground">
            Birthday <span className="font-normal text-foreground-subtle">(optional)</span>
          </legend>
          <p className="mb-2 text-body-xs text-foreground-subtle">
            For a birthday treat. We do not ask for the year.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Select name="birthMonth" defaultValue={birthMonth ?? ''} aria-label="Birth month">
              <option value="">Month</option>
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </Select>

            <Select name="birthDay" defaultValue={birthDay ?? ''} aria-label="Birth day">
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <Button type="submit" variant="secondary" isLoading={pending}>
          Save preferences
        </Button>
      </form>

      <Result result={result} />
    </Panel>
  );
}

/**
 * Account closure.
 *
 * Behind a modal, requiring both a password and the typed word DELETE. A
 * checkbox is muscle memory and a password is what a browser fills in for you;
 * typing is the only one of the three that means "I understand this is
 * irreversible".
 */
export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData) => deleteAccountAction(formData),
    EMPTY,
  );

  return (
    <section className="rounded-2xl border border-danger-500/30 bg-surface p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
        <AlertTriangle aria-hidden="true" className="size-4 text-danger-700" />
        Close your account
      </h2>
      <p className="mt-1 text-body-sm text-foreground-muted">
        Your order history is kept — we are required to retain records of sales — but your
        profile, addresses, saved cards, wishlist and browsing history are deleted, and you
        will not be able to sign in again.
      </p>

      <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>
        Close my account
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Close your account">
        <form action={action} noValidate className="space-y-4">
          <Alert variant="danger" title="This cannot be undone">
            Everything except your order history is permanently deleted.
          </Alert>

          <Field
            id="deletePassword"
            name="password"
            type="password"
            label="Your password"
            autoComplete="current-password"
            error={result.fieldErrors?.password?.[0]}
          />

          <Field
            id="confirmation"
            name="confirmation"
            label="Type DELETE to confirm"
            autoComplete="off"
            error={result.fieldErrors?.confirmation?.[0]}
          />

          <div>
            <label htmlFor="reason" className="mb-1.5 block text-body-sm font-medium text-foreground">
              Anything we could have done better?{' '}
              <span className="font-normal text-foreground-subtle">(optional)</span>
            </label>
            <Textarea id="reason" name="reason" rows={3} maxLength={500} />
          </div>

          <Result result={result} />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="danger" isLoading={pending}>
              Permanently close my account
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

export { CheckboxField };
