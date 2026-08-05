'use client';

import { LogOut, Monitor, ShieldCheck } from 'lucide-react';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { revokeOtherSessionsAction, revokeSessionAction } from '@/server/actions/account';

/**
 * Signed-in devices.
 *
 * The current device is marked and cannot be revoked from its own row — signing
 * yourself out from a list of other devices is almost always a misclick. "Sign
 * out everywhere else" is the deliberate version, and it is separate.
 */

export interface SessionRow {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  isCurrent: boolean;
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function revoke(sessionId: string) {
    startTransition(async () => {
      const result = await revokeSessionAction(sessionId);
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  function revokeOthers() {
    startTransition(async () => {
      const result = await revokeOtherSessionsAction();
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  const others = sessions.filter((session) => !session.isCurrent).length;

  return (
    <div>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <Monitor aria-hidden="true" className="size-5 shrink-0 text-foreground-subtle" />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-foreground">
                {session.device}
                {session.isCurrent ? <Badge variant="success">This device</Badge> : null}
              </p>
              <p className="text-body-xs text-foreground-subtle">
                {session.ipAddress ? `${session.ipAddress} · ` : ''}
                Last active{' '}
                {session.lastSeenAt.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>

            {!session.isCurrent ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => revoke(session.id)}
              >
                <LogOut aria-hidden="true" className="size-4" />
                Sign out
                <span className="sr-only"> {session.device}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {others > 0 ? (
        <Button variant="outline" className="mt-4" disabled={pending} onClick={revokeOthers}>
          <ShieldCheck aria-hidden="true" className="size-4" />
          Sign out everywhere else ({others})
        </Button>
      ) : null}

      <p className="text-body-xs mt-3 text-foreground-subtle">
        Signing a device out takes effect immediately — the next thing that device tries to do will
        ask it to sign in again.
      </p>
    </div>
  );
}
