'use client';

import { useActionState } from 'react';

import { forgotPasswordAction } from '@/actions/auth.actions';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, null);

  // The confirmation is intentionally identical whether or not the address
  // exists — anything else turns this form into an account-enumeration tool.
  if (state?.ok) {
    return (
      <Alert variant="success" title="Check your inbox">
        If that email address has an account, a reset link is on its way. It expires in one hour.
      </Alert>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      {state && !state.ok ? <Alert variant="danger">{state.error}</Alert> : null}

      <FormField label="Email address" error={state?.fieldErrors?.email?.[0]} required>
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

      <SubmitButton fullWidth size="lg">
        Send reset link
      </SubmitButton>
    </form>
  );
}
