import type { Metadata } from 'next';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/constants/routes';
import { buildMetadata } from '@/lib/seo/metadata';
import { isAdmin, requireUser } from '@/server/auth/session';

export const metadata: Metadata = buildMetadata({
  title: 'Your account',
  path: ROUTES.account.root,
  noindex: true,
});

/**
 * Signed-in landing page.
 *
 * Deliberately minimal. Sign-in and the edge proxy both send authenticated
 * visitors here, so it has to exist — but the real account area (orders,
 * addresses, wishlist) is phase 4 work.
 *
 * Until then it earns its keep as a live readout of the session: if roles and
 * permissions render correctly here, the whole auth chain — credentials, JWT
 * claims, the role tables — is wired up.
 */
export default async function AccountPage() {
  const user = await requireUser(ROUTES.account.root);

  return (
    <Container as="main" width="content" className="py-16" id="main">
      <p className="text-eyebrow text-accent uppercase">Account</p>
      <h1 className="mt-3 text-display-lg text-foreground">
        {user.name ? `Hello, ${user.name}` : 'Hello'}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-foreground-muted">
        You are signed in as {user.email}.
      </p>

      {!user.isEmailVerified ? (
        <Alert variant="warning" title="Email not confirmed" className="mt-8">
          Transactional email is not configured yet, so the confirmation link was logged to the
          server console instead of being sent.
        </Alert>
      ) : null}

      <Card className="mt-8" variant="outline">
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>What the current token grants.</CardDescription>
        </CardHeader>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-foreground-muted">Roles</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {user.roles.length ? (
                user.roles.map((role) => (
                  <Badge key={role} variant={isAdmin(user) ? 'accent' : 'neutral'}>
                    {role}
                  </Badge>
                ))
              ) : (
                <span className="text-foreground-subtle">
                  None — run <code className="font-mono">npm run db:seed</code>
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-foreground-muted">Permissions</dt>
            <dd className="mt-1.5 font-medium text-foreground">
              {user.permissions.length} granted
            </dd>
          </div>
        </dl>
      </Card>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href={ROUTES.auth.signOut}>Sign out</Link>
        </Button>
      </div>

      <p className="mt-10 text-xs leading-relaxed text-foreground-subtle">
        Orders, addresses and saved items arrive in a later phase.
      </p>
    </Container>
  );
}
