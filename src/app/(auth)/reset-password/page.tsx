import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordForm } from '@/app/(auth)/reset-password/reset-password-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Choose a new password',
  path: ROUTES.auth.resetPassword,
  noindex: true,
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card padding="lg" variant="elevated" className="space-y-5">
        <Alert variant="danger" title="Link not valid">
          This password reset link is missing its token. Request a new one.
        </Alert>
        <Button asChild fullWidth>
          <Link href={ROUTES.auth.forgotPassword}>Request a new link</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card padding="lg" variant="elevated">
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-display-md text-foreground">Choose a new password</h1>
        <p className="text-sm text-foreground-muted">
          Pick something you haven&apos;t used elsewhere.
        </p>
      </div>

      <ResetPasswordForm token={token} />
    </Card>
  );
}
