'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInAction } from '@/actions/auth.actions';
import { signInSchema, type SignInInput } from '@/features/auth/schemas';
import { safeRedirectPath } from '@/lib/security/sanitize';

/**
 * Sign-in form.
 *
 * The reference implementation for every form in the app: React Hook Form for
 * client-side validation against the shared Zod schema, a server action for the
 * work, and a `Result` translated into either field errors or a form-level alert.
 */
export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const callbackUrl = safeRedirectPath(searchParams.get('callbackUrl'), '/account');

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '', redirectTo: callbackUrl },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('email', values.email);
      formData.set('password', values.password);
      formData.set('redirectTo', callbackUrl);

      const result = await signInAction(null, formData);

      if (!result.ok) {
        // Surface field-level messages where they belong, everything else at the top.
        for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (field in values && messages[0]) {
            setError(field as keyof SignInInput, { message: messages[0] });
          }
        }
        setFormError(result.fieldErrors ? null : result.error);
        return;
      }

      router.push(result.data.redirectTo);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      <FormField label="Email address" error={errors.email?.message} required>
        {(field) => (
          <Input
            {...field}
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        )}
      </FormField>

      <FormField label="Password" error={errors.password?.message} required>
        {(field) => (
          <Input
            {...field}
            {...register('password')}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••"
          />
        )}
      </FormField>

      <Button type="submit" fullWidth size="lg" isLoading={isPending}>
        Sign in
      </Button>
    </form>
  );
}
