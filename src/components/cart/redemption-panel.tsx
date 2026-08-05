'use client';

import { Sparkles, Wallet } from 'lucide-react';
import { useTransition } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { setRedemptionAction } from '@/server/actions/cart';
import type { CartView } from '@/services/cart.service';
import { formatPrice } from '@/utils/format';

/**
 * Spending points and store credit on a basket.
 *
 * Rendered only for a signed-in customer who has something to spend — a panel
 * offering a zero balance is noise on the page where noise costs the most.
 *
 * Store credit is listed first because it is applied first: it does not expire
 * and has no minimum, so spending it before points is strictly better for the
 * customer. The order is not a preference, it is the rule.
 */
export function RedemptionPanel({ redemption }: { redemption: CartView['redemption'] }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const available = redemption.available;
  if (!available) return null;

  const hasCredit = available.storeCreditCents > 0;
  const hasPoints = available.pointsBalance >= available.minimumPoints;
  if (!hasCredit && !hasPoints) return null;

  function update(input: { applyStoreCredit?: boolean; redeemPoints?: boolean }) {
    startTransition(async () => {
      const result = await setRedemptionAction(input);
      if (!result.ok) toast({ variant: 'error', title: result.message });
    });
  }

  return (
    <div className="bg-accent-subtle rounded-xl border border-accent/30 p-4">
      <h3 className="text-body-sm font-semibold text-foreground">Use your rewards</h3>

      <div className="mt-3 space-y-2">
        {hasCredit ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={redemption.applyStoreCredit}
              disabled={pending}
              onChange={(event) => update({ applyStoreCredit: event.target.checked })}
            />
            <span className="text-body-sm text-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <Wallet aria-hidden="true" className="size-4 text-accent-text" />
                Store credit
              </span>
              <span className="text-body-xs block text-foreground-muted">
                {formatPrice(available.storeCreditCents)} available
              </span>
            </span>
          </label>
        ) : null}

        {hasPoints ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={redemption.redeemPoints}
              disabled={pending}
              onChange={(event) => update({ redeemPoints: event.target.checked })}
            />
            <span className="text-body-sm text-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <Sparkles aria-hidden="true" className="size-4 text-accent-text" />
                Points
              </span>
              <span className="text-body-xs block text-foreground-muted">
                {available.pointsBalance} points · worth {formatPrice(available.pointsValueCents)}
              </span>
            </span>
          </label>
        ) : null}
      </div>

      {redemption.totalCents > 0 ? (
        <p aria-live="polite" className="mt-3 border-t border-accent/20 pt-3 text-body-sm">
          <span className="font-medium text-accent-text">
            {formatPrice(redemption.totalCents)} off this order
          </span>
          <span className="text-body-xs block text-foreground-muted">
            {redemption.amountDueCents === 0
              ? 'Covered in full — nothing will be charged to a card.'
              : `${formatPrice(redemption.amountDueCents)} left to pay by card.`}
          </span>
        </p>
      ) : null}

      {!hasPoints && available.pointsBalance > 0 ? (
        <p className="text-body-xs mt-3 text-foreground-subtle">
          You need {available.minimumPoints - available.pointsBalance} more points before you can
          spend them.
        </p>
      ) : null}
    </div>
  );
}
