'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { registerAction } from '@/actions/auth.actions';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

/**
 * Registration form.
 *
 * Uses `useActionState` with a plain `<form action>`: the form submits and
 * validates server-side even before hydration finishes, which matters on the
 * slow mobile connections a lot of our traffic arrives on.
 */
export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);

  if (state?.ok) {
    return (
      <Alert variant="success" title="Check your inbox">
        We sent a confirmation link to <strong>{state.data.email}</strong>. Click it to activate
        your account.
      </Alert>
    );
  }

  const fieldError = (name: string) => state?.fieldErrors?.[name]?.[0];

  return (
    <form action={action} noValidate className="space-y-5">
      {state && !state.ok && !state.fieldErrors ? (
        <Alert variant="danger">{state.error}</Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="First name" error={fieldError('firstName')} required>
          {(field) => <Input {...field} name="firstName" autoComplete="given-name" />}
        </FormField>

        <FormField label="Last name" error={fieldError('lastName')} required>
          {(field) => <Input {...field} name="lastName" autoComplete="family-name" />}
        </FormField>
      </div>

      <FormField label="Email address" error={fieldError('email')} required>
        {(field) => (
          <Input
            {...field}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        )}
      </FormField>

      <FormField
        label="Password"
        error={fieldError('password')}
        hint="At least 10 characters. A memorable phrase beats a short, complicated word."
        required
      >
        {(field) => (
          <Input {...field} name="password" type="password" autoComplete="new-password" />
        )}
      </FormField>

      <FormField label="Confirm password" error={fieldError('confirmPassword')} required>
        {(field) => (
          <Input {...field} name="confirmPassword" type="password" autoComplete="new-password" />
        )}
      </FormField>

      <div className="space-y-3 pt-1">
        <label className="flex items-start gap-3 text-sm leading-relaxed text-foreground-muted">
          <Checkbox name="acceptsTerms" className="mt-0.5" />
          <span>
            I am 18 or older and agree to the{' '}
            <Link href="/pages/terms" className="text-accent underline underline-offset-2">
              terms of service
            </Link>{' '}
            and{' '}
            <Link href="/pages/privacy" className="text-accent underline underline-offset-2">
              privacy policy
            </Link>
            .
          </span>
        </label>
        {fieldError('acceptsTerms') ? (
          <p role="alert" className="text-xs font-medium text-danger-700">
            {fieldError('acceptsTerms')}
          </p>
        ) : null}

        <label className="flex items-start gap-3 text-sm leading-relaxed text-foreground-muted">
          <Checkbox name="acceptsMarketing" className="mt-0.5" />
          <span>Email me new arrivals and offers. Discreet subject lines, always.</span>
        </label>
      </div>

      <SubmitButton fullWidth size="lg">
        Create account
      </SubmitButton>
    </form>
  );
}
