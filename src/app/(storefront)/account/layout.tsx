import type { Metadata } from 'next';

import { AccountNav } from '@/components/account/account-nav';
import { Container } from '@/components/layout/container';
import { isAdmin, requireUser } from '@/server/auth/session';

/**
 * Account shell.
 *
 * The authentication gate for everything under `/account`. Guarding here rather
 * than in each page means a new page added to this folder is protected by
 * default — the alternative is protected by memory, and memory is where the
 * unguarded page comes from.
 *
 * `requireUser` redirects to sign-in with a return path, so someone who follows
 * a link from an email lands where they meant to after signing in.
 */
export const metadata: Metadata = {
  title: { default: 'Your account', template: '%s · Your account · INTIMATE BUNNIE' },
  // Every page here is personal. `nocache` and `noimageindex` are belt and braces
  // for crawlers that ignore the first directive.
  robots: { index: false, follow: false, nocache: true, noimageindex: true },
};

/** Personal data, read per request. Nothing here may ever be cached. */
export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/account');

  return (
    <Container className="py-6 sm:py-10">
      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {/*
            Decided here, not in the nav: `isAdmin` reads the session, and the
            nav is a client component. Passing the boolean keeps the roles on
            the server where they are already loaded.
          */}
          <AccountNav isAdmin={isAdmin(user)} />
        </aside>

        <div className="min-w-0 pt-6 lg:pt-0">{children}</div>
      </div>
    </Container>
  );
}
