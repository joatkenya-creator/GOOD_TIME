import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { formatDateTime, formatMoney } from '@/features/admin/query';
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  RETURN_STATUS_TONE,
  humaniseEnum,
} from '@/features/admin/status';
import {
  addOrderNoteAction,
  fulfilOrderAction,
  transitionOrderAction,
} from '@/server/actions/admin/orders';
import { maskAddress, maskEmail, maskPhone, requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { getAdminOrder } from '@/services/admin/commerce-admin.service';
import { CARRIERS } from '@/services/admin/fulfilment.service';

export const metadata: Metadata = { title: 'Order' };

interface AddressSnapshot {
  firstName?: string;
  lastName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
}

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.orderRead);
  const { orderNumber } = await params;

  const order = await getAdminOrder(decodeURIComponent(orderNumber));
  if (!order) notFound();

  const seePii = can(user, PERMISSIONS.customerPii);
  const canFulfil = can(user, PERMISSIONS.orderFulfil);
  const canRefund = can(user, PERMISSIONS.orderRefund);
  const canCancel = can(user, PERMISSIONS.orderCancel);
  const canNote = can(user, PERMISSIONS.orderWrite);

  const shipTo = order.shippingAddressSnapshot as AddressSnapshot | null;

  return (
    <>
      <AdminPageHeader
        title={order.orderNumber}
        description={`Placed ${formatDateTime(order.placedAt ?? order.createdAt)} · ${formatMoney(order.totalCents)}`}
        pathname="/admin/orders"
        trail={[{ label: order.orderNumber }]}
        actions={
          <>
            <StatusPill label={humaniseEnum(order.status)} tone={ORDER_STATUS_TONE[order.status]} />
            <StatusPill
              label={humaniseEnum(order.paymentStatus)}
              tone={PAYMENT_STATUS_TONE[order.paymentStatus]}
            />
          </>
        }
      />

      {order.riskFlags.length > 0 ? (
        <div className="mb-6 rounded-xl border border-danger-700/30 bg-danger-50 p-4">
          <h2 className="text-body-sm font-semibold text-danger-700">Flagged for review</h2>
          <p className="mt-1 text-body-sm text-foreground-muted">
            {order.riskFlags.join(', ')}
            {order.riskScore !== null ? ` · risk score ${order.riskScore}/100` : ''}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <AdminCard title="Items">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-border text-body-xs tracking-wide text-foreground-subtle uppercase">
                    <th scope="col" className="py-2 pr-3">Item</th>
                    <th scope="col" className="py-2 pr-3 text-right">Qty</th>
                    <th scope="col" className="py-2 pr-3 text-right">Unit</th>
                    <th scope="col" className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="block">{item.productName}</span>
                        <span className="block text-body-xs text-foreground-subtle">
                          {item.variantName} · {item.sku}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{item.quantity}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {formatMoney(item.unitPriceCents)}
                      </td>
                      <td className="py-2.5 text-right font-medium tabular-nums">
                        {formatMoney(item.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-border pt-4 text-body-sm">
              <Row label="Subtotal" value={formatMoney(order.subtotalCents)} />
              {order.discountCents > 0 ? (
                <Row
                  label={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`}
                  value={`−${formatMoney(order.discountCents)}`}
                />
              ) : null}
              <Row label="Shipping" value={formatMoney(order.shippingCents)} />
              <Row label="Tax" value={formatMoney(order.taxCents)} />
              <Row label="Total" value={formatMoney(order.totalCents)} strong />
              {order.creditAppliedCents > 0 ? (
                <Row
                  label="Store credit applied"
                  value={`−${formatMoney(order.creditAppliedCents)}`}
                />
              ) : null}
            </dl>
          </AdminCard>

          <AdminCard title="Timeline" description="Every state change, in order">
            {order.events.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-foreground-subtle">
                Nothing recorded.
              </p>
            ) : (
              <ol className="space-y-3">
                {order.events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium">{humaniseEnum(event.type)}</p>
                      {event.message ? (
                        <p className="text-body-xs text-foreground-muted">{event.message}</p>
                      ) : null}
                      <p className="text-body-xs text-foreground-subtle">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>

          {order.returnRequests.length > 0 ? (
            <AdminCard title="Returns">
              <ul className="divide-y divide-border">
                {order.returnRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium">{request.returnNumber}</p>
                      <p className="text-body-xs text-foreground-subtle">
                        {request.items.length} items · {formatDateTime(request.createdAt)}
                      </p>
                    </div>
                    <StatusPill
                      label={humaniseEnum(request.status)}
                      tone={RETURN_STATUS_TONE[request.status]}
                    />
                  </li>
                ))}
              </ul>
            </AdminCard>
          ) : null}

          <AdminCard title="Internal notes" description="Never shown to the customer">
            {order.staffNotes.length > 0 ? (
              <ul className="mb-4 divide-y divide-border">
                {order.staffNotes.map((note) => (
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

            {canNote ? (
              <form action={addOrderNoteAction} className="space-y-2">
                <input type="hidden" name="orderId" value={order.id} />
                <label htmlFor="note-body" className="sr-only">
                  Add a note
                </label>
                <textarea
                  id="note-body"
                  name="body"
                  rows={2}
                  required
                  placeholder="Add a note for the team…"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm"
                />
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-body-xs">
                    <input
                      type="checkbox"
                      name="isPinned"
                      className="size-3.5 rounded border-border-strong text-accent"
                    />
                    Pin to the top
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-3 py-1.5 text-body-xs font-medium text-white hover:bg-accent-hover"
                  >
                    Add note
                  </button>
                </div>
              </form>
            ) : null}
          </AdminCard>
        </div>

        <aside className="space-y-6">
          <AdminCard title="Customer">
            <p className="text-body-sm font-medium">
              {[order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || 'Guest'}
            </p>
            <p className="text-body-sm text-foreground-muted">{maskEmail(order.email, seePii)}</p>

            {order.user ? (
              <Link
                href={`/admin/customers/${order.user.id}`}
                className="mt-2 inline-block text-body-xs font-medium text-accent-text hover:underline"
              >
                View customer
              </Link>
            ) : (
              <p className="mt-2 text-body-xs text-foreground-subtle">
                Guest checkout — no account.
              </p>
            )}
          </AdminCard>

          <AdminCard title="Shipping">
            {shipTo ? (
              <address className="text-body-sm not-italic text-foreground-muted">
                {seePii ? (
                  <>
                    <span className="block">
                      {[shipTo.firstName, shipTo.lastName].filter(Boolean).join(' ')}
                    </span>
                    <span className="block">{shipTo.line1}</span>
                    {shipTo.line2 ? <span className="block">{shipTo.line2}</span> : null}
                    <span className="block">
                      {[shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(', ')}
                    </span>
                    <span className="block">{shipTo.country}</span>
                    {shipTo.phone ? (
                      <span className="mt-1 block">{maskPhone(shipTo.phone, seePii)}</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="block">{maskAddress(shipTo, false)}</span>
                    <span className="mt-1 block text-body-xs text-foreground-subtle">
                      Full address hidden — needs the customer PII permission.
                    </span>
                  </>
                )}
              </address>
            ) : (
              <p className="text-body-sm text-foreground-subtle">No address recorded.</p>
            )}

            {order.shippingMethod ? (
              <p className="mt-3 text-body-xs text-foreground-subtle">{order.shippingMethod}</p>
            ) : null}

            {order.shipments[0] ? (
              <p className="mt-1 text-body-xs">
                {order.shipments[0].carrier}
                {order.shipments[0].trackingNumber ? (
                  <>
                    {' · '}
                    {order.shipments[0].trackingUrl ? (
                      <Link
                        href={order.shipments[0].trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-accent-text hover:underline"
                      >
                        {order.shipments[0].trackingNumber}
                      </Link>
                    ) : (
                      <span className="font-mono">{order.shipments[0].trackingNumber}</span>
                    )}
                  </>
                ) : (
                  <span className="text-foreground-subtle"> · no tracking number yet</span>
                )}
              </p>
            ) : null}
          </AdminCard>

          <AdminCard title="Actions">
            <div className="space-y-2">
              {canFulfil && order.shipments.length === 0 ? (
                /*
                  Fulfilling records a shipment and moves the order in one step.
                  A bare "mark shipped" button leaves a customer with an order
                  that claims to be in transit and a timeline that cannot say
                  where — which is the exact moment they contact support.
                */
                <form action={fulfilOrderAction} className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-body-xs font-medium">Fulfil this order</p>
                  <input type="hidden" name="orderId" value={order.id} />

                  <div className="flex gap-2">
                    <label htmlFor="carrier" className="sr-only">
                      Carrier
                    </label>
                    <select
                      id="carrier"
                      name="carrier"
                      className="h-9 flex-1 rounded-lg border border-border bg-surface px-2 text-body-xs"
                    >
                      {CARRIERS.map((carrier) => (
                        <option key={carrier.value} value={carrier.value}>
                          {carrier.label}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="service" className="sr-only">
                      Service
                    </label>
                    <input
                      id="service"
                      name="service"
                      placeholder="Ground"
                      className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-body-xs"
                    />
                  </div>

                  <label htmlFor="tracking" className="sr-only">
                    Tracking number
                  </label>
                  <input
                    id="tracking"
                    name="trackingNumber"
                    placeholder="Tracking number (optional)"
                    className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-body-xs"
                  />

                  <button
                    type="submit"
                    className="w-full rounded-lg bg-accent px-3 py-2 text-body-sm font-medium text-white hover:bg-accent-hover"
                  >
                    Mark shipped
                  </button>
                </form>
              ) : null}

              {canFulfil && order.shipments.length > 0 ? (
                <TransitionButton orderId={order.id} to="DELIVERED" label="Mark delivered" />
              ) : null}
              {canCancel ? (
                <TransitionButton orderId={order.id} to="CANCELLED" label="Cancel order" danger />
              ) : null}

              <Link
                href={`/api/admin/orders/${order.orderNumber}/packing-slip`}
                className="block rounded-lg border border-border px-3 py-2 text-center text-body-sm font-medium hover:bg-surface-muted"
              >
                Packing slip
              </Link>

              {canFulfil ? (
                <Link
                  href={`/api/admin/orders/${order.orderNumber}/label`}
                  className="block rounded-lg border border-border px-3 py-2 text-center text-body-sm font-medium hover:bg-surface-muted"
                >
                  Shipping label
                </Link>
              ) : null}

              <Link
                href={`/order/${order.orderNumber}?email=${encodeURIComponent(order.email)}`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-border px-3 py-2 text-center text-body-sm font-medium hover:bg-surface-muted"
              >
                Customer&rsquo;s view
              </Link>

              {!canRefund ? (
                <p className="pt-1 text-body-xs text-foreground-subtle">
                  Refunds need the refund permission, which this role does not hold.
                </p>
              ) : (
                <p className="pt-1 text-body-xs text-foreground-subtle">
                  Refunds are issued from the payment provider and reconciled here — see
                  docs/admin.md.
                </p>
              )}
            </div>
          </AdminCard>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-medium' : 'text-foreground-muted'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

function TransitionButton({
  orderId,
  to,
  label,
  danger,
}: {
  orderId: string;
  to: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <form action={transitionOrderAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="status" value={to} />
      <button
        type="submit"
        className={`w-full rounded-lg border px-3 py-2 text-body-sm font-medium ${
          danger
            ? 'border-danger-700/30 text-danger-700 hover:bg-danger-50'
            : 'border-border hover:bg-surface-muted'
        }`}
      >
        {label}
      </button>
    </form>
  );
}
