import { RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ReturnList } from '@/components/account/return-list';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ROUTES } from '@/constants/routes';
import { requireUser } from '@/server/auth/session';
import { listReturns } from '@/services/return.service';

export const metadata: Metadata = { title: 'Returns' };

export default async function ReturnsPage() {
  const user = await requireUser();
  const returns = await listReturns(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Returns</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Anything you have sent back, and where it has got to.
        </p>
      </header>

      {returns.length === 0 ? (
        <EmptyState
          icon={<RotateCcw aria-hidden="true" className="size-8" />}
          title="No returns"
          description="You can request a return from any delivered order within 30 days. For hygiene reasons we can only accept unopened items."
          action={
            <Button asChild variant="secondary">
              <Link href={ROUTES.account.orders}>View your orders</Link>
            </Button>
          }
        />
      ) : (
        <ReturnList returns={returns} />
      )}
    </div>
  );
}
