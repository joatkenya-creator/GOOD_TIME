import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { MediaPlaceholder } from '@/components/common/media-placeholder';
import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@/generated/prisma/enums';
import { formatPrice } from '@/utils/format';

/**
 * One order, summarised.
 *
 * Shared by the dashboard and the order history so the two cannot describe the
 * same order differently — the kind of drift that has a customer reading
 * "Shipped" on one page and "Processing" on the next.
 */

export const ORDER_STATUS_TONE: Record<
  OrderStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  PENDING: { label: 'Awaiting payment', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  PROCESSING: { label: 'Being packed', tone: 'info' },
  SHIPPED: { label: 'Shipped', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
};

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalCents: number;
  placedAt: Date | null;
  createdAt: Date;
  estimatedDeliveryAt?: Date | null;
  items: { id: string; productName: string; sku: string; quantity: number }[];
  shipments?: { trackingNumber: string | null; carrier: string }[];
}

export function OrderSummaryCard({ order }: { order: OrderSummary }) {
  const status = ORDER_STATUS_TONE[order.status];
  const placed = order.placedAt ?? order.createdAt;
  const tracking = order.shipments?.[0];

  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Link
      href={`/account/orders/${order.orderNumber}`}
      className="group block rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-foreground-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring) sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-body-sm font-semibold text-foreground">
            {order.orderNumber}
          </p>
          <p className="text-body-xs text-foreground-subtle">
            {placed.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant={status.tone}>{status.label}</Badge>
          <span className="text-body font-semibold text-foreground tabular-nums">
            {formatPrice(order.totalCents)}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-foreground-subtle transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex -space-x-2">
          {order.items.slice(0, 3).map((item) => (
            <MediaPlaceholder
              key={item.id}
              seed={item.sku}
              ratio="square"
              className="size-10 rounded-lg ring-2 ring-(--color-surface)"
            />
          ))}
        </div>

        <p className="min-w-0 flex-1 truncate text-body-sm text-foreground-muted">
          {order.items[0]?.productName}
          {itemCount > 1 ? ` and ${itemCount - 1} more` : ''}
        </p>
      </div>

      {tracking?.trackingNumber ? (
        <p className="text-body-xs mt-3 text-foreground-subtle">
          {tracking.carrier} · {tracking.trackingNumber}
        </p>
      ) : order.estimatedDeliveryAt && !['CANCELLED', 'REFUNDED'].includes(order.status) ? (
        <p className="text-body-xs mt-3 text-foreground-subtle">
          Estimated delivery{' '}
          {order.estimatedDeliveryAt.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      ) : null}
    </Link>
  );
}
