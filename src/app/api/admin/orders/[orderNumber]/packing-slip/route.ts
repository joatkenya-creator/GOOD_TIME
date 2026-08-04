import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/constants/permissions';
import { siteConfig } from '@/config/site';
import { errors } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { assertAdminPermission } from '@/server/auth/admin';
import { getAdminOrder } from '@/services/admin/commerce-admin.service';

/**
 * A packing slip, as a printable page.
 *
 * The browser's own print dialogue produces the PDF. Shipping a server-side PDF
 * engine to render one table would add a large dependency and a font-embedding
 * problem to solve something already solved.
 *
 * Deliberately not an invoice: no prices. Warehouse staff need to know what to
 * put in the box; the customer's own confirmation carries what they paid, and
 * this category ships in plain packaging — a price list inside the parcel
 * defeats the point of the plain box.
 */
export const GET = withRoute(async ({ params }) => {
  await assertAdminPermission(PERMISSIONS.orderFulfil);

  const orderNumber = decodeURIComponent(String((await params).orderNumber ?? ''));
  const order = await getAdminOrder(orderNumber);
  if (!order) throw errors.notFound('Order');

  const address = order.shippingAddressSnapshot as Record<string, string> | null;

  const rows = order.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.productName)}<br><span class="muted">${escapeHtml(item.variantName)}</span></td>
        <td class="mono">${escapeHtml(item.sku)}</td>
        <td class="right qty">${item.quantity}</td>
        <td class="tick"></td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Packing slip ${escapeHtml(order.orderNumber)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #333; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
  h1 { font-size: 1.1rem; margin: 0; }
  .muted { color: #707070; font-size: .75rem; }
  .mono { font-family: ui-monospace, monospace; font-size: .75rem; }
  address { font-style: normal; font-size: .85rem; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; margin-top: 1.5rem; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: .6rem .5rem; text-align: left; vertical-align: top; }
  th { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; color: #707070; }
  .right { text-align: right; }
  .qty { font-weight: 600; }
  .tick { width: 2.5rem; border-left: 1px solid #e5e5e5; }
  footer { margin-top: 2.5rem; font-size: .75rem; color: #707070; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <header>
    <div>
      <h1>Packing slip</h1>
      <p class="muted">${escapeHtml(order.orderNumber)} · ${new Date(order.placedAt ?? order.createdAt).toISOString().slice(0, 10)}</p>
    </div>
    <div class="muted">${escapeHtml(siteConfig.name)}</div>
  </header>

  <address>
    <strong>Ship to</strong><br>
    ${address ? escapeHtml([address.firstName, address.lastName].filter(Boolean).join(' ')) : '—'}<br>
    ${address?.line1 ? `${escapeHtml(address.line1)}<br>` : ''}
    ${address?.line2 ? `${escapeHtml(address.line2)}<br>` : ''}
    ${address ? escapeHtml([address.city, address.state, address.postalCode].filter(Boolean).join(', ')) : ''}<br>
    ${address?.country ? escapeHtml(address.country) : ''}
  </address>

  <table>
    <thead><tr><th>Item</th><th>SKU</th><th class="right">Qty</th><th>✓</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <footer>
    No prices are printed on this slip. ${escapeHtml(siteConfig.name)} ships in plain, unbranded
    packaging — an itemised price list inside the parcel would undo that.
  </footer>

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
