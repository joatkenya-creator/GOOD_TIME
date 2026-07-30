import type { Metadata } from 'next';
import Link from 'next/link';

import { RegisterForm } from '@/app/(auth)/register/register-form';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Create an account',
  path: ROUTES.auth.register,
  noindex: true,
});

export default function RegisterPage() {
  return (
    <Card padding="lg" variant="elevated">
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-display-md text-foreground">Create your account</h1>
        <p className="text-sm text-foreground-muted">
          Faster checkout, order tracking and a private wishlist.
        </p>
      </div>

      <RegisterForm />

      <p className="mt-6 text-center text-sm text-foreground-muted">
        Already have an account?{' '}
        <Link href={ROUTES.auth.signIn} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
