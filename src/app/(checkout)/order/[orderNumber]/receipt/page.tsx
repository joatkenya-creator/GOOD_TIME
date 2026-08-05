import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { siteConfig } from '@/config/site';
import { getSessionUser } from '@/server/auth/session';
import { getOrderByNumber } from '@/services/order.service';
import { formatPrice } from '@/utils/format';

/**
 * Printable receipt.
 *
 * Its own page rather than a print stylesheet on the order page: a receipt needs
 * the billing address, the tax breakdown and no navigation, and expressing all of
 * that as `print:hidden` on a page built for the screen produces something that
 * is wrong in both media.
 *
 * Plain HTML with no client JavaScript — `Ctrl+P` and "Save as PDF" are the two
 * things anyone actually does with this.
 */
export const metadata: Metadata = {
  title: 'Receipt',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const { orderNumber } = await params;
  const { email } = await searchParams;

  const user = await getSessionUser();
  const lookupEmail = email ?? user?.email;
  if (!lookupEmail) notFound();

  const order = await getOrderByNumber(orderNumber, lookupEmail);
  if (!order) notFound();

  const taxLines = Array.isArray(order.taxBreakdown)
    ? (order.taxBreakdown as { label: string; rateBasisPoints: number; amountCents: number }[])
    : [];

  // Snapshot first — it is present on guest orders, where no Address row exists.
  const snapshot = (order.billingAddressSnapshot ?? order.shippingAddressSnapshot) as {
    firstName?: string;
    lastName?: string;
    line1?: string;
    line2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
  } | null;

  const address = snapshot?.line1 ? snapshot : (order.billingAddress ?? order.shippingAddress);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 text-foreground print:px-0 print:py-0">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-6">
        <div>
          <p className="font-display text-2xl tracking-tight">{siteConfig.name}</p>
          <p className="text-body-xs mt-1 text-foreground-subtle">Receipt</p>
        </div>

        <dl className="text-body-xs text-right">
          <dt className="text-foreground-subtle">Order</dt>
          <dd className="font-mono text-body-sm font-semibold">{order.orderNumber}</dd>

          <dt className="mt-2 text-foreground-subtle">Date</dt>
          <dd className="text-body-sm">
            {(order.paidAt ?? order.placedAt ?? order.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </dd>
        </dl>
      </header>

      <div className="grid gap-6 py-6 sm:grid-cols-2">
        <section>
          <h2 className="text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
            Billed to
          </h2>
          <p className="mt-1.5 text-body-sm">
            {address ? (
              <>
                {address.firstName} {address.lastName}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city}, {address.state} {address.postalCode}
              </>
            ) : (
              order.email
            )}
          </p>
        </section>

        <section>
          <h2 className="text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
            Payment
          </h2>
          <p className="mt-1.5 text-body-sm">
            {order.paymentStatus === 'PAID' ? 'Paid in full' : order.paymentStatus.toLowerCase()}
            <br />
            <span className="text-body-xs text-foreground-subtle">
              {order.shippingMethod ?? 'Standard shipping'}
            </span>
          </p>
        </section>
      </div>

      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="border-y border-border text-left">
            <th scope="col" className="py-2 font-medium">
              Item
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Qty
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Unit
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-border">
              <td className="py-2.5">
                {item.productName}
                <span className="text-body-xs block text-foreground-subtle">
                  {item.variantName} · {item.sku}
                </span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{item.quantity}</td>
              <td className="py-2.5 text-right tabular-nums">{formatPrice(item.unitPriceCents)}</td>
              <td className="py-2.5 text-right tabular-nums">{formatPrice(item.totalCents)}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <TotalRow label="Subtotal" value={formatPrice(order.subtotalCents)} />

          {order.discountCents > 0 ? (
            <TotalRow
              label={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`}
              value={`−${formatPrice(order.discountCents)}`}
            />
          ) : null}

          <TotalRow
            label={order.shippingMethod ?? 'Shipping'}
            value={order.shippingCents === 0 ? 'Free' : formatPrice(order.shippingCents)}
          />

          {/* Itemised, because a customer disputing a charge — or an auditor —
              needs the split, not just the total. */}
          {taxLines.length > 0 ? (
            taxLines.map((line) => (
              <TotalRow
                key={line.label}
                label={`${line.label} (${(line.rateBasisPoints / 100).toFixed(2)}%)`}
                value={formatPrice(line.amountCents)}
              />
            ))
          ) : (
            <TotalRow label="Sales tax" value={formatPrice(order.taxCents)} />
          )}

          <tr className="border-t border-border">
            <th scope="row" colSpan={3} className="py-3 text-left text-body font-bold">
              Total
            </th>
            <td className="py-3 text-right text-body font-bold tabular-nums">
              {formatPrice(order.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>

      <footer className="text-body-xs mt-8 border-t border-border pt-4 text-foreground-subtle">
        <p>
          Thank you for your order. Questions? Reply to your confirmation email and a real person
          will answer.
        </p>
        <p className="mt-1">
          All items shipped in plain, unbranded packaging. Card statement shows a neutral
          descriptor.
        </p>
      </footer>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" colSpan={3} className="py-1 text-left font-normal text-foreground-muted">
        {label}
      </th>
      <td className="py-1 text-right tabular-nums">{value}</td>
    </tr>
  );
}
