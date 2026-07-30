import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '@/app/(auth)/forgot-password/forgot-password-form';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Reset your password',
  path: ROUTES.auth.forgotPassword,
  noindex: true,
});

export default function ForgotPasswordPage() {
  return (
    <Card padding="lg" variant="elevated">
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-display-md text-foreground">Reset your password</h1>
        <p className="text-sm text-foreground-muted">
          Enter your email address and we&apos;ll send you a link to choose a new one.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-foreground-muted">
        Remembered it?{' '}
        <Link href={ROUTES.auth.signIn} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
