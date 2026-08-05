import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDate, formatDateTime, formatMoney } from '@/features/admin/query';
import { ORDER_STATUS_TONE, humaniseEnum } from '@/features/admin/status';
import { addCustomerNoteAction, setCustomerTagsAction } from '@/server/actions/admin/orders';
import { maskEmail, maskPhone, requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { getAdminCustomer } from '@/services/admin/commerce-admin.service';

export const metadata: Metadata = { title: 'Customer' };

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireAdminPermission(PERMISSIONS.customerRead);
  const { id } = await params;

  const record = await getAdminCustomer(id);
  if (!record) notFound();

  const { user, orders, lifetimeValueCents, paidOrderCount, averageOrderCents } = record;

  const seePii = can(staff, PERMISSIONS.customerPii);
  const canWrite = can(staff, PERMISSIONS.customerWrite);

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'No name';

  return (
    <>
      <AdminPageHeader
        title={name}
        description={`${maskEmail(user.email, seePii)} · joined ${formatDate(user.createdAt)}`}
        pathname="/admin/customers"
        trail={[{ label: name }]}
        actions={
          <StatusPill
            label={humaniseEnum(user.status)}
            tone={user.status === 'ACTIVE' ? 'success' : 'danger'}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Lifetime value"
          value={formatMoney(lifetimeValueCents)}
          changePercent={null}
        />
        <StatCard label="Paid orders" value={String(paidOrderCount)} changePercent={null} />
        <StatCard
          label="Average order"
          value={formatMoney(averageOrderCents)}
          changePercent={null}
        />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <AdminCard title="Orders" description={`${orders.length} most recent`}>
            {orders.length === 0 ? (
              <p className="py-6 text-center text-body-sm text-foreground-subtle">
                This customer has not ordered yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/admin/orders/${order.orderNumber}`}
                        className="block truncate text-body-sm font-medium hover:text-accent-text"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="text-body-xs text-foreground-subtle">
                        {order._count.items} items · {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusPill
                        label={humaniseEnum(order.status)}
                        tone={ORDER_STATUS_TONE[order.status]}
                      />
                      <span className="text-body-sm font-medium tabular-nums">
                        {formatMoney(order.totalCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard title="Internal notes" description="Never shown to the customer">
            {user.staffNotesAbout.length > 0 ? (
              <ul className="mb-4 divide-y divide-border">
                {user.staffNotesAbout.map((note) => (
                  <li key={note.id} className="py-2.5 first:pt-0">
                    <p className="text-body-sm">{note.body}</p>
                    <p className="text-body-xs text-foreground-subtle">
                      {note.author?.firstName ?? note.author?.email ?? 'Unknown'} ·{' '}
                      {formatDateTime(note.createdAt)}
                      {note.isPinned ? ' · pinned' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {canWrite ? (
              <form action={addCustomerNoteAction} className="space-y-2">
                <input type="hidden" name="userId" value={user.id} />
                <label htmlFor="customer-note" className="sr-only">
                  Add a note
                </label>
                <textarea
                  id="customer-note"
                  name="body"
                  rows={2}
                  required
                  placeholder="Add a note for the team…"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="text-body-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="isPinned"
                      className="size-3.5 rounded border-border-strong text-accent"
                    />
                    Pin to the top
                  </label>
                  <button
                    type="submit"
                    className="text-body-xs rounded-lg bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-hover"
                  >
                    Add note
                  </button>
                </div>
              </form>
            ) : null}
          </AdminCard>
        </div>

        <aside className="space-y-6">
          <AdminCard title="Contact">
            <dl className="space-y-2 text-body-sm">
              <Row label="Email" value={maskEmail(user.email, seePii)} />
              <Row label="Phone" value={maskPhone(user.phone, seePii) ?? '—'} />
              <Row
                label="Verified"
                value={user.emailVerified ? formatDate(user.emailVerified) : 'Not verified'}
              />
              <Row
                label="Last sign-in"
                value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
              />
              <Row label="Marketing" value={user.acceptsMarketing ? 'Opted in' : 'Opted out'} />
            </dl>

            {!seePii ? (
              <p className="text-body-xs mt-3 text-foreground-subtle">
                Details are masked. Reading them in full needs the customer PII permission.
              </p>
            ) : null}
          </AdminCard>

          <AdminCard title="Addresses">
            {user.addresses.length === 0 ? (
              <p className="text-body-sm text-foreground-subtle">None saved.</p>
            ) : (
              <ul className="space-y-3">
                {user.addresses.map((address) => (
                  <li key={address.id} className="text-body-sm text-foreground-muted">
                    {seePii ? (
                      <>
                        <span className="block">{address.line1}</span>
                        <span className="block">
                          {[address.city, address.state, address.postalCode]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </>
                    ) : (
                      <span className="block">
                        {[address.state, address.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                    {address.isDefault ? <StatusPill label="Default" tone="accent" /> : null}
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          {user.rewardAccount ? (
            <AdminCard title="Loyalty">
              <dl className="space-y-2 text-body-sm">
                <Row label="Tier" value={humaniseEnum(user.rewardAccount.tier)} />
                <Row label="Points" value={String(user.rewardAccount.pointsBalance)} />
                <Row
                  label="Store credit"
                  value={formatMoney(user.rewardAccount.storeCreditCents)}
                />
              </dl>
            </AdminCard>
          ) : null}

          <AdminCard title="Tags" description="For segmentation. Not visible to the customer.">
            {canWrite ? (
              <form action={setCustomerTagsAction} className="space-y-2">
                <input type="hidden" name="userId" value={user.id} />
                <label htmlFor="tags" className="sr-only">
                  Tags, comma separated
                </label>
                <input
                  id="tags"
                  name="tags"
                  defaultValue={user.adminTags.join(', ')}
                  placeholder="vip, wholesale, chargeback"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-border px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
                >
                  Save tags
                </button>
              </form>
            ) : user.adminTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {user.adminTags.map((tag) => (
                  <StatusPill key={tag} label={tag} tone="neutral" />
                ))}
              </div>
            ) : (
              <p className="text-body-sm text-foreground-subtle">No tags.</p>
            )}
          </AdminCard>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
