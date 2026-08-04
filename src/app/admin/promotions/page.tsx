import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDate, formatMoney } from '@/features/admin/query';
import { humaniseEnum } from '@/features/admin/status';
import { issueGiftCardAction } from '@/server/actions/admin/orders';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import {
  listCoupons,
  listGiftCards,
  listReferralCodes,
} from '@/services/admin/commerce-admin.service';

export const metadata: Metadata = { title: 'Promotions' };

/**
 * Coupons, gift cards, store credit and referrals on one screen.
 *
 * They are all "ways value leaves the business", and someone auditing that
 * should not have to visit four pages to see the whole picture.
 */
export default async function AdminPromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ issued?: string }>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.couponRead);
  const { issued } = await searchParams;

  const [coupons, giftCards, referrals] = await Promise.all([
    listCoupons(),
    listGiftCards(),
    listReferralCodes(),
  ]);

  const canIssueCredit = can(user, PERMISSIONS.creditIssue);

  return (
    <>
      <AdminPageHeader
        title="Promotions"
        description="Coupons, gift cards and referrals."
        pathname="/admin/promotions"
      />

      {issued ? (
        /*
          Shown once, then gone. The code exists in this response and nowhere
          else — only its hash was stored — so the copy has to happen now.
        */
        <div className="mb-6 rounded-xl border border-success-700/30 bg-success-50 p-4">
          <h2 className="text-body-sm font-semibold text-success-700">Gift card issued</h2>
          <p className="mt-1 font-mono text-display-xs tracking-wider">{issued}</p>
          <p className="mt-2 text-body-xs text-foreground-muted">
            Copy this now and send it to the recipient. Only a hash is stored, so it cannot be
            shown again — not to you, not to anyone. Reload this page and it is gone.
          </p>
        </div>
      ) : null}

      <div className="space-y-6">
        <AdminCard title="Coupons" description={`${coupons.length} codes`}>
          {coupons.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              No coupons yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border text-body-xs tracking-wide text-foreground-subtle uppercase">
                    <th scope="col" className="py-2 pr-3">Code</th>
                    <th scope="col" className="py-2 pr-3">Discount</th>
                    <th scope="col" className="py-2 pr-3">Status</th>
                    <th scope="col" className="py-2 pr-3 text-right">Used</th>
                    <th scope="col" className="py-2 text-right">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => {
                    return (
                      <tr key={coupon.id} className="border-b border-border last:border-0">
                        <td className="py-2.5 pr-3 font-mono text-body-xs font-medium">
                          {coupon.code}
                        </td>
                        <td className="py-2.5 pr-3">
                          {coupon.type === 'PERCENTAGE'
                            ? `${coupon.value}%`
                            : coupon.type === 'FIXED_AMOUNT'
                              ? formatMoney(coupon.value)
                              : humaniseEnum(coupon.type)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusPill
                            label={
                              {
                                disabled: 'Disabled',
                                expired: 'Expired',
                                exhausted: 'Used up',
                                active: 'Active',
                              }[coupon.state]
                            }
                            tone={
                              (
                                {
                                  disabled: 'neutral',
                                  expired: 'warning',
                                  exhausted: 'warning',
                                  active: 'success',
                                } as const
                              )[coupon.state]
                            }
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {coupon._count.redemptions}
                          {coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ''}
                        </td>
                        <td className="py-2.5 text-right text-body-xs text-foreground-subtle">
                          {coupon.endsAt ? formatDate(coupon.endsAt) : 'No expiry'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>

        <AdminCard
          title="Gift cards"
          description="Redeemable at checkout. Applied after tax, as tender."
          actions={
            canIssueCredit ? (
              <details className="relative">
                <summary className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-body-xs font-medium text-white">
                  Issue a card
                </summary>
                <form
                  action={issueGiftCardAction}
                  className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-border bg-surface p-4 shadow-lg"
                >
                  <div>
                    <label htmlFor="gc-amount" className="mb-1 block text-body-xs font-medium">
                      Amount ($)
                    </label>
                    <input
                      id="gc-amount"
                      name="amount"
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="gc-email" className="mb-1 block text-body-xs font-medium">
                      Recipient email
                    </label>
                    <input
                      id="gc-email"
                      name="email"
                      type="email"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="gc-expires" className="mb-1 block text-body-xs font-medium">
                      Expires
                    </label>
                    <input
                      id="gc-expires"
                      name="expiresAt"
                      type="date"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="gc-note" className="mb-1 block text-body-xs font-medium">
                      Note
                    </label>
                    <input
                      id="gc-note"
                      name="note"
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-accent px-3 py-2 text-body-xs font-medium text-white hover:bg-accent-hover"
                  >
                    Issue
                  </button>
                  <p className="text-body-xs text-foreground-subtle">
                    The code is shown once and never stored in readable form.
                  </p>
                </form>
              </details>
            ) : null
          }
        >
          {!canIssueCredit ? (
            <p className="py-4 text-body-sm text-foreground-subtle">
              Issuing gift cards creates spendable value, so it needs the credit permission.
            </p>
          ) : giftCards.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              None issued yet. Codes are stored hashed — a leaked database should not be a stack of
              bearer instruments.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {giftCards.map((card) => (
                <li key={card.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-mono text-body-sm">•••• {card.last4}</p>
                    <p className="truncate text-body-xs text-foreground-subtle">
                      {card.issuedToEmail ?? 'Unassigned'} · issued{' '}
                      {formatDate(card.createdAt)}
                      {card.expiresAt ? ` · expires ${formatDate(card.expiresAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill
                      label={humaniseEnum(card.status)}
                      tone={card.status === 'ACTIVE' ? 'success' : 'neutral'}
                    />
                    <span className="text-body-sm font-medium tabular-nums">
                      {formatMoney(card.balanceCents)}
                      <span className="ml-1 text-body-xs font-normal text-foreground-subtle">
                        of {formatMoney(card.initialCents)}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        <AdminCard title="Referrals" description="Codes customers can share">
          {referrals.length === 0 ? (
            <p className="py-6 text-center text-body-sm text-foreground-subtle">
              No referral codes issued.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {referrals.map((code) => (
                <li key={code.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-mono text-body-sm">{code.code}</p>
                    <p className="truncate text-body-xs text-foreground-subtle">
                      {code.user?.firstName ?? code.user?.email ?? 'Unknown'}
                    </p>
                  </div>
                  <span className="shrink-0 text-body-sm tabular-nums">
                    {code.uses} uses
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>
    </>
  );
}
