import {
  CheckCircle2,
  Clock,
  CreditCard,
  Package,
  Printer,
  Truck,
  XCircle,
} from 'lucide-react';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/generated/prisma/enums';
import type { getOrderById } from '@/services/order.service';
import { formatPrice } from '@/utils/format';

type Order = NonNullable<Awaited<ReturnType<typeof getOrderById>>>;

interface AddressShape {
  firstName?: string;
  lastName?: string;
  company?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
}

/**
 * The destination as recorded on the order.
 *
 * Prefers the snapshot: it exists for every order including guest ones, and it
 * cannot be rewritten by someone later editing their address book.
 */
function shippingAddressOf(order: Order): AddressShape | null {
  const snapshot = order.shippingAddressSnapshot as AddressShape | null;
  if (snapshot?.line1) return snapshot;
  return order.shippingAddress ?? null;
}

/**
 * The order, as a customer sees it.
 *
 * One component for the post-checkout confirmation, the account history and the
 * guest lookup — all three ask the same question ("what did I buy and where is
 * it"), and three answers would eventually disagree.
 *
 * Everything shown is the snapshot stored on the order, never a live join to the
 * catalogue: a receipt has to keep saying what was actually charged after the
 * product is renamed, repriced or deleted.
 */

const STATUS_COPY: Record<
  OrderStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger'; description: string }
> = {
  PENDING: {
    label: 'Awaiting payment',
    tone: 'warning',
    description: 'We are holding your items. They ship as soon as payment clears.',
  },
  PAID: {
    label: 'Paid',
    tone: 'success',
    description: 'Payment received. We are packing your order now.',
  },
  CONFIRMED: {
    label: 'Confirmed',
    tone: 'success',
    description: 'Your order is confirmed and queued for packing.',
  },
  PROCESSING: {
    label: 'Being packed',
    tone: 'info',
    description: 'We are packing your order in plain, unbranded packaging.',
  },
  SHIPPED: { label: 'Shipped', tone: 'info', description: 'Your order is on its way.' },
  DELIVERED: { label: 'Delivered', tone: 'success', description: 'Your order has arrived.' },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'danger',
    description: 'This order was cancelled. Any charge has been reversed.',
  },
  REFUNDED: {
    label: 'Refunded',
    tone: 'info',
    description: 'This order was refunded to your original payment method.',
  },
  RETURNED: { label: 'Returned', tone: 'info', description: 'We have received your return.' },
};

const STATUS_ICON: Record<OrderStatus, typeof Package> = {
  PENDING: Clock,
  PAID: CreditCard,
  CONFIRMED: CheckCircle2,
  PROCESSING: Package,
  SHIPPED: Truck,
  DELIVERED: CheckCircle2,
  CANCELLED: XCircle,
  REFUNDED: CreditCard,
  RETURNED: Package,
};

export function OrderDetail({ order, isNew = false }: { order: Order; isNew?: boolean }) {
  const status = STATUS_COPY[order.status];
  const StatusIcon = STATUS_ICON[order.status];
  const shipment = order.shipments[0];
  const shipTo = shippingAddressOf(order);

  return (
    <div className="space-y-8">
      <header className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent-subtle">
          <StatusIcon aria-hidden="true" className="size-7 text-accent-text" />
        </div>

        <h1 className="mt-4 text-h2 font-bold text-foreground">
          {isNew ? 'Thank you — your order is in' : `Order ${order.orderNumber}`}
        </h1>

        <p className="mt-2 text-body text-foreground-muted">{status.description}</p>

        <p className="mt-4 text-body-sm text-foreground-subtle">
          Order number{' '}
          <strong className="font-mono text-foreground">{order.orderNumber}</strong> · Confirmation
          sent to {order.email}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Badge variant={status.tone}>{status.label}</Badge>

        {order.estimatedDeliveryAt && !['CANCELLED', 'REFUNDED'].includes(order.status) ? (
          <span className="text-body-sm text-foreground-muted">
            Estimated delivery{' '}
            <strong className="text-foreground">
              {order.estimatedDeliveryAt.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </strong>
          </span>
        ) : null}
      </div>

      {shipment?.trackingNumber ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <p className="text-body-sm text-foreground-muted">
            {shipment.carrier} tracking:{' '}
            {shipment.trackingUrl ? (
              <a
                href={shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-medium text-accent-text underline"
              >
                {shipment.trackingNumber}
              </a>
            ) : (
              <span className="font-mono font-medium text-foreground">
                {shipment.trackingNumber}
              </span>
            )}
          </p>
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-4 text-body font-semibold text-foreground">
          What you ordered
        </h2>

        <ul className="divide-y divide-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start gap-4 p-5">
              <MediaPlaceholder seed={item.sku} ratio="square" className="size-16 rounded-lg" />

              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-foreground">{item.productName}</p>
                <p className="text-body-xs text-foreground-subtle">
                  {item.variantName} · Qty {item.quantity}
                </p>
              </div>

              <span className="shrink-0 text-body-sm tabular-nums text-foreground">
                {formatPrice(item.totalCents)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-2 border-t border-border p-5 text-body-sm">
          <Row label="Subtotal">{formatPrice(order.subtotalCents)}</Row>

          {order.discountCents > 0 ? (
            <Row label={`Discount${order.couponCode ? ` · ${order.couponCode}` : ''}`}>
              −{formatPrice(order.discountCents)}
            </Row>
          ) : null}

          <Row label={order.shippingMethod ?? 'Shipping'}>
            {order.shippingCents === 0 ? 'Free' : formatPrice(order.shippingCents)}
          </Row>

          <Row label="Sales tax">{formatPrice(order.taxCents)}</Row>

          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <dt className="text-body font-semibold text-foreground">Total</dt>
            <dd className="text-h5 font-bold tabular-nums text-foreground">
              {formatPrice(order.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        {shipTo ? (
          <Panel title="Shipping to">
            {shipTo.firstName} {shipTo.lastName}
            <br />
            {shipTo.line1}
            {shipTo.line2 ? (
              <>
                <br />
                {shipTo.line2}
              </>
            ) : null}
            <br />
            {shipTo.city}, {shipTo.state} {shipTo.postalCode}
          </Panel>
        ) : null}

        <Panel title="Delivery">
          {order.shippingMethod ?? 'Standard shipping'}
          <br />
          <span className="text-body-xs text-foreground-subtle">
            Plain, unbranded box. The sender name on the label is discreet.
          </span>
        </Panel>
      </div>

      {order.giftNote ? (
        <Panel title="Gift note">{order.giftNote}</Panel>
      ) : null}

      <OrderTimeline events={order.events.filter((event) => event.isCustomerVisible)} />

      {/* A plain link, not a JS print button: it works with the page open in a
          new tab, and it works if the script never loads. */}
      <p className="text-center print:hidden">
        <a
          href={`/order/${order.orderNumber}/receipt?email=${encodeURIComponent(order.email)}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-body-sm font-medium text-accent-text underline underline-offset-4 hover:text-accent-hover"
        >
          <Printer aria-hidden="true" className="size-4" />
          Printable receipt
        </a>
      </p>
    </div>
  );
}

/**
 * The order's history.
 *
 * Only customer-visible events. Internal notes and email-delivery records live on
 * the same table and are filtered out — "where is my order" deserves an answer,
 * not our operations log.
 */
function OrderTimeline({ events }: { events: Order['events'] }) {
  if (events.length === 0) return null;

  return (
    <section>
      <h2 className="text-body font-semibold text-foreground">Order history</h2>

      <ol className="mt-3 space-y-0">
        {events.map((event, index) => (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
              {index < events.length - 1 ? (
                <span className="w-px flex-1 bg-border" aria-hidden="true" />
              ) : null}
            </div>

            <div className="pb-5">
              <p className="text-body-sm text-foreground">{event.message}</p>
              <time
                dateTime={event.createdAt.toISOString()}
                className="text-body-xs text-foreground-subtle"
              >
                {event.createdAt.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
        {title}
      </h3>
      <p className="mt-1.5 text-body-sm text-foreground">{children}</p>
    </div>
  );
}
