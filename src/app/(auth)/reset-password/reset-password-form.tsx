'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { resetPasswordAction } from '@/actions/auth.actions';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ROUTES } from '@/constants/routes';

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);

  if (state?.ok) {
    return (
      <div className="space-y-5">
        <Alert variant="success" title="Password updated">
          You have been signed out of all devices. Sign in with your new password.
        </Alert>
        <Button asChild fullWidth size="lg">
          <Link href={ROUTES.auth.signIn}>Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && !state.fieldErrors ? (
        <Alert variant="danger">{state.error}</Alert>
      ) : null}

      <FormField
        label="New password"
        error={state?.fieldErrors?.password?.[0]}
        hint="At least 10 characters."
        required
      >
        {(field) => (
          <Input {...field} name="password" type="password" autoComplete="new-password" />
        )}
      </FormField>

      <FormField
        label="Confirm new password"
        error={state?.fieldErrors?.confirmPassword?.[0]}
        required
      >
        {(field) => (
          <Input {...field} name="confirmPassword" type="password" autoComplete="new-password" />
        )}
      </FormField>

      <SubmitButton fullWidth size="lg">
        Update password
      </SubmitButton>
    </form>
  );
}
