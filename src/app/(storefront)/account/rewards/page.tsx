import { Gift, Sparkles, Users, Wallet } from 'lucide-react';
import type { Metadata } from 'next';

import { ReferralCodeBlock } from '@/components/account/referral-code';
import { Badge } from '@/components/ui/badge';
import {
  MIN_REDEEMABLE_POINTS,
  POINTS_EXPIRY_MONTHS,
  POINTS_PER_DOLLAR,
  REFERRAL_MIN_ORDER_CENTS,
  REFERRAL_REWARD_CENTS,
  TIERS,
  multiplierForTier,
  nextTier,
  pointsToCents,
} from '@/features/account/rewards-rules';
import { requireUser } from '@/server/auth/session';
import {
  TIER_LABELS,
  getReferralCode,
  getRewardAccount,
  getTransactions,
  trailingSpendCents,
} from '@/services/account/rewards.service';
import { formatPrice } from '@/utils/format';

export const metadata: Metadata = { title: 'Rewards' };

/**
 * Rewards, referrals and store credit.
 *
 * States the actual rules rather than gesturing at a programme. A customer who
 * cannot work out what earns them anything treats the whole thing as noise.
 *
 * Every number on this page is imported from `rewards-rules.ts` rather than
 * retyped, so the page cannot drift away from what the code actually pays.
 */
export default async function RewardsPage() {
  const user = await requireUser();

  const [account, transactions, referral, spend] = await Promise.all([
    getRewardAccount(user.id),
    getTransactions(user.id, 20),
    getReferralCode(user.id),
    trailingSpendCents(user.id),
  ]);

  const next = nextTier(spend);
  const multiplier = multiplierForTier(account.tier);
  const progress = next
    ? Math.min(100, Math.round((spend / (spend + next.remainingCents)) * 100))
    : 100;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-bold text-foreground">Rewards</h1>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Your points, store credit and referral code.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <span className="flex items-center gap-1.5 text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
            <Sparkles aria-hidden="true" className="size-4" />
            Points
          </span>
          <p className="mt-2 text-h3 font-bold tabular-nums text-foreground">
            {account.pointsBalance}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <span className="flex items-center gap-1.5 text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
            <Wallet aria-hidden="true" className="size-4" />
            Store credit
          </span>
          <p className="mt-2 text-h3 font-bold tabular-nums text-foreground">
            {formatPrice(account.storeCreditCents)}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <span className="flex items-center gap-1.5 text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
            <Gift aria-hidden="true" className="size-4" />
            Tier
          </span>
          <p className="mt-2 flex items-center gap-2">
            <span className="text-h3 font-bold text-foreground">{TIER_LABELS[account.tier]}</span>
          </p>
        </div>
      </div>

      {next ? (
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-body font-semibold text-foreground">
              {formatPrice(next.remainingCents)} to {TIER_LABELS[next.tier]}
            </h2>
            <span className="text-body-sm text-foreground-muted">
              {formatPrice(spend)} spent in the last year
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress towards ${TIER_LABELS[next.tier]}`}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-body-lg font-semibold text-foreground">How it works</h2>

        <dl className="mt-4 space-y-3 text-body-sm">
          <div>
            <dt className="font-medium text-foreground">Earning</dt>
            <dd className="text-foreground-muted">
              {POINTS_PER_DOLLAR} point per $1 spent on products, times your tier multiplier —
              currently {multiplier}×. Shipping, tax, and anything a discount already took off do
              not earn.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-foreground">Spending</dt>
            <dd className="text-foreground-muted">
              {MIN_REDEEMABLE_POINTS} points minimum, worth{' '}
              {formatPrice(pointsToCents(MIN_REDEEMABLE_POINTS))}. Tick the box in your bag and it
              comes off at checkout.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-foreground">Expiry</dt>
            <dd className="text-foreground-muted">
              Points last {POINTS_EXPIRY_MONTHS} months from the day you earn them. Store credit
              never expires.
            </dd>
          </div>

          <div>
            <dt className="font-medium text-foreground">Tiers</dt>
            <dd className="text-foreground-muted">
              Based on what you spend in a rolling twelve months, so your tier reflects where you
              are now rather than where you once were.
            </dd>
          </div>
        </dl>

        <table className="mt-5 w-full border-collapse text-body-sm">
          <caption className="sr-only">Tier thresholds and earning multipliers</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-2 font-medium">
                Tier
              </th>
              <th scope="col" className="py-2 font-medium">
                Yearly spend
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Earns
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...TIERS].reverse().map((entry) => (
              <tr key={entry.tier}>
                <th scope="row" className="py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    {TIER_LABELS[entry.tier]}
                    {entry.tier === account.tier ? <Badge variant="accent">You</Badge> : null}
                  </span>
                </th>
                <td className="py-2 text-foreground-muted">
                  {entry.minSpendCents === 0 ? 'Everyone' : `${formatPrice(entry.minSpendCents)}+`}
                </td>
                <td className="py-2 text-right tabular-nums">{entry.multiplier}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
          <Users aria-hidden="true" className="size-4 text-foreground-subtle" />
          Refer a friend
        </h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          When someone you refer places a first order of{' '}
          {formatPrice(REFERRAL_MIN_ORDER_CENTS)} or more, you get{' '}
          {formatPrice(REFERRAL_REWARD_CENTS)} in store credit.
        </p>

        <ReferralCodeBlock code={referral.code} uses={referral.uses} />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-body-lg font-semibold text-foreground">Activity</h2>

        {transactions.length === 0 ? (
          <p className="mt-3 text-body-sm text-foreground-subtle">
            Nothing yet. Points appear here as soon as an order is paid for.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-body-sm text-foreground">{transaction.description}</p>
                  <p className="text-body-xs text-foreground-subtle">
                    {transaction.createdAt.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>

                <div className="text-right">
                  {transaction.points !== 0 ? (
                    <p className="text-body-sm font-medium tabular-nums text-foreground">
                      {transaction.points > 0 ? '+' : ''}
                      {transaction.points} pts
                    </p>
                  ) : null}
                  {transaction.amountCents !== 0 ? (
                    <p className="text-body-sm font-medium tabular-nums text-foreground">
                      {transaction.amountCents > 0 ? '+' : '-'}
                      {formatPrice(Math.abs(transaction.amountCents))}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
