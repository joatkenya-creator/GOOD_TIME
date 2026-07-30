import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/constants/routes';
import { isAppError } from '@/lib/api/errors';
import { buildMetadata } from '@/lib/seo/metadata';
import { verifyEmail } from '@/services/user.service';

export const metadata: Metadata = buildMetadata({
  title: 'Verify your email',
  path: ROUTES.auth.verifyEmail,
  noindex: true,
});

/**
 * Email verification landing page.
 *
 * Consumes the token server-side on render. A GET that mutates state is
 * acceptable here because the token is single-use and the alternative — a page
 * with a "confirm" button — costs a step for no security gain.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    return (
      <Shell>
        <Alert variant="info" title="Check your inbox">
          We sent you a confirmation link. Open it on this device to activate your account.
        </Alert>
      </Shell>
    );
  }

  try {
    await verifyEmail(email, token);
  } catch (error) {
    return (
      <Shell>
        <Alert variant="danger" title="We could not verify that link">
          {isAppError(error) ? error.message : 'Something went wrong. Please try again.'}
        </Alert>
        <Button asChild fullWidth className="mt-5">
          <Link href={ROUTES.auth.signIn}>Back to sign in</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <Alert variant="success" title="Email confirmed">
        Your account is ready. Sign in to get started.
      </Alert>
      <Button asChild fullWidth className="mt-5">
        <Link href={ROUTES.auth.signIn}>Sign in</Link>
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="lg" variant="elevated">
      <h1 className="mb-6 text-center text-display-md text-foreground">Email verification</h1>
      {children}
    </Card>
  );
}
