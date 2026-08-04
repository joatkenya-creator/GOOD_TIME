import { NextResponse } from 'next/server';

import { siteConfig } from '@/config/site';
import { PERMISSIONS } from '@/constants/permissions';
import { errors } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { assertAdminPermission } from '@/server/auth/admin';
import { getShipmentForLabel } from '@/services/admin/fulfilment.service';

/**
 * A shipping label, as a printable page.
 *
 * **Not carrier postage.** This is the label that goes on the box: sender,
 * recipient, order reference and the tracking number if one has been recorded.
 * Buying real postage needs a carrier account and a funding source, which is a
 * production integration this phase does not own — and printing something that
 * *looks* like carrier postage but is not would be worse than printing nothing,
 * because a parcel would leave with an invalid barcode on it.
 *
 * Sized for a 4×6 thermal label, the standard shipping-label stock, so it
 * prints correctly on a label printer as well as on paper.
 *
 * The sender is deliberately the neutral name, not the store's: this category
 * ships in plain packaging, and a branded label undoes that at the sorting
 * office, on the doorstep and in front of whoever collects the post.
 */
export const GET = withRoute(async ({ params }) => {
  await assertAdminPermission(PERMISSIONS.orderFulfil);

  const orderNumber = decodeURIComponent(String((await params).orderNumber ?? ''));
  const order = await getShipmentForLabel(orderNumber);
  if (!order) throw errors.notFound('Order');

  const to = order.shippingAddressSnapshot as Record<string, string> | null;
  if (!to) throw errors.badRequest('That order has no shipping address recorded.');

  const shipment = order.shipments[0] ?? null;
  const pieces = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Label ${escapeHtml(order.orderNumber)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #000; }
  .label {
    width: 4in; height: 6in; padding: .28in; border: 1px solid #000;
    display: flex; flex-direction: column; margin: 0 auto;
  }
  .row { display: flex; justify-content: space-between; align-items: flex-start; }
  .tiny { font-size: 7pt; text-transform: uppercase; letter-spacing: .06em; }
  .from { font-size: 8pt; line-height: 1.35; }
  .to { font-size: 13pt; line-height: 1.4; font-weight: 600; margin-top: .06in; }
  .rule { border-top: 2px solid #000; margin: .16in 0; }
  .service { font-size: 20pt; font-weight: 800; letter-spacing: -.01em; }
  .tracking { font-family: ui-monospace, monospace; font-size: 11pt; letter-spacing: .04em; }
  .foot { margin-top: auto; font-size: 7.5pt; }
  .none { font-size: 9pt; padding: .1in; border: 1px dashed #000; text-align: center; }
  @media screen { body { background: #f5f5f5; padding: 1rem; } }
</style></head>
<body>
  <div class="label">
    <div class="row">
      <div>
        <div class="tiny">From</div>
        <div class="from">
          ${escapeHtml(siteConfig.legalName)}<br>
          Fulfilment Centre<br>
          Wilmington, DE 19801<br>
          United States
        </div>
      </div>
      <div style="text-align:right">
        <div class="tiny">Order</div>
        <div class="tracking">${escapeHtml(order.orderNumber)}</div>
      </div>
    </div>

    <div class="rule"></div>

    <div class="tiny">Ship to</div>
    <div class="to">
      ${escapeHtml([to.firstName, to.lastName].filter(Boolean).join(' '))}<br>
      ${to.company ? `${escapeHtml(to.company)}<br>` : ''}
      ${escapeHtml(to.line1 ?? '')}<br>
      ${to.line2 ? `${escapeHtml(to.line2)}<br>` : ''}
      ${escapeHtml([to.city, to.state, to.postalCode].filter(Boolean).join(' '))}<br>
      ${escapeHtml(to.country ?? '')}
    </div>

    <div class="rule"></div>

    <div class="service">${escapeHtml(shipment?.carrier ?? 'CARRIER')} ${escapeHtml(shipment?.service ?? order.shippingMethod ?? '')}</div>

    ${
      shipment?.trackingNumber
        ? `<div style="margin-top:.1in">
             <div class="tiny">Tracking</div>
             <div class="tracking">${escapeHtml(shipment.trackingNumber)}</div>
           </div>`
        : `<div class="none" style="margin-top:.12in">
             No tracking number recorded yet.<br>
             This label carries no carrier postage — buy it from the carrier and write the
             tracking number back against the order.
           </div>`
    }

    <div class="foot">
      ${pieces} item${pieces === 1 ? '' : 's'} ·
      ${new Date(order.placedAt ?? order.createdAt).toISOString().slice(0, 10)}<br>
      Plain packaging. No product names appear on this label or on the parcel.
    </div>
  </div>

  <script>window.addEventListener("load", () => window.print());</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
