'use client';

import Link from 'next/link';
import { useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cancelReturnAction } from '@/server/actions/wishlist';
import { RETURN_STATUS_COPY } from '@/features/account/returns';
import type { ReturnRecord } from '@/services/return.service';
import { formatPrice } from '@/utils/format';

/**
 * Return requests, newest first.
 *
 * Cancelling is offered only while the request is still `REQUESTED` — once it is
 * approved a label may exist and the parcel may already be moving, and cancelling
 * from under that produces a return nobody is expecting.
 */
export function ReturnList({ returns }: { returns: ReturnRecord[] }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  function cancel(returnNumber: string) {
    startTransition(async () => {
      const result = await cancelReturnAction(returnNumber);
      toast({ variant: result.ok ? 'success' : 'error', title: result.message });
    });
  }

  return (
    <ul className="space-y-4">
      {returns.map((request) => {
        const status = RETURN_STATUS_COPY[request.status];

        return (
          <li key={request.id} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-body-sm font-semibold text-foreground">
                  {request.returnNumber}
                </p>
                <p className="text-body-xs text-foreground-subtle">
                  Order{' '}
                  <Link
                    href={`/account/orders/${request.order.orderNumber}`}
                    className="underline underline-offset-2"
                  >
                    {request.order.orderNumber}
                  </Link>{' '}
                  ·{' '}
                  {request.createdAt.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>

              <Badge variant={status.tone}>{status.label}</Badge>
            </div>

            <p className="mt-3 text-body-sm text-foreground-muted">{status.description}</p>

            <ul className="mt-4 space-y-1.5">
              {request.items.map((item) => (
                <li key={item.id} className="text-body-sm text-foreground">
                  {item.quantity} × {item.orderItem.productName}
                  <span className="text-foreground-subtle"> · {item.orderItem.variantName}</span>
                </li>
              ))}
            </ul>

            {request.comment ? (
              <p className="mt-3 rounded-lg bg-surface-muted p-3 text-body-sm text-foreground-muted">
                “{request.comment}”
              </p>
            ) : null}

            {request.refundCents != null ? (
              <p className="mt-3 text-body-sm text-foreground">
                Refunded <strong>{formatPrice(request.refundCents)}</strong>
              </p>
            ) : null}

            {request.trackingNumber ? (
              <p className="mt-3 text-body-xs text-foreground-subtle">
                Return tracking: {request.carrier} {request.trackingNumber}
              </p>
            ) : null}

            {request.status === 'REQUESTED' ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                disabled={pending}
                onClick={() => cancel(request.returnNumber)}
              >
                Cancel this return
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
