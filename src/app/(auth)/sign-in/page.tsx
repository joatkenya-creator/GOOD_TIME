import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Sign in',
  path: ROUTES.auth.signIn,
  noindex: true,
});

export default function SignInPage() {
  return (
    <Card padding="lg" variant="elevated">
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-display-md text-foreground">Welcome back</h1>
        <p className="text-sm text-foreground-muted">Sign in to your account to continue.</p>
      </div>

      {/* `useSearchParams` needs a Suspense boundary to keep the page statically rendered. */}
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <SignInForm />
      </Suspense>

      <div className="mt-6 space-y-3 text-center text-sm">
        <p>
          <Link
            href={ROUTES.auth.forgotPassword}
            className="text-accent underline underline-offset-2"
          >
            Forgot your password?
          </Link>
        </p>
        <p className="text-foreground-muted">
          New here?{' '}
          <Link
            href={ROUTES.auth.register}
            className="font-medium text-accent underline underline-offset-2"
          >
            Create an account
          </Link>
        </p>
      </div>
    </Card>
  );
}
