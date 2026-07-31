import 'server-only';

import { publicEnv } from '@/lib/env.public';
import { sendEmail } from '@/lib/integrations/resend';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { recordEvent } from '@/services/order.service';

/**
 * Transactional email.
 *
 * Hand-written HTML rather than a rendering library: email clients are stuck in
 * 2005, so the markup is tables and inline styles either way, and a template
 * literal produces exactly that without another dependency to keep current.
 *
 * ## Discretion
 *
 * This store sells adult products. Every subject line and every preview text is
 * written to be safe on a lock screen or a shared laptop — "Your order is
 * confirmed", never a product name. The sender name is set by `EMAIL_FROM`, and
 * the same reasoning applies to it and to the statement descriptor.
 *
 * Sending is best-effort: `sendEmail` never throws, and no email failure is
 * allowed to roll back a paid order.
 */

const BRAND = {
  pink: '#E91E63',
  darkGrey: '#333333',
  mediumGrey: '#666666',
  lightGrey: '#F5F5F5',
  border: '#E5E5E5',
};

const siteUrl = () => publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

/**
 * Shared shell.
 *
 * `preheader` is the grey line a client shows next to the subject in the inbox
 * list. Left unset it picks up whatever text comes first, which is usually
 * "View this email in your browser" — a wasted, and here indiscreet, first
 * impression.
 */
function layout(options: { title: string; preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.lightGrey};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.darkGrey};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.lightGrey};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};">
      <tr><td style="padding:24px;border-bottom:1px solid ${BRAND.border};">
        <a href="${siteUrl()}" style="font-size:20px;font-weight:700;letter-spacing:0.02em;color:${BRAND.pink};text-decoration:none;">GOOD TIME</a>
      </td></tr>
      <tr><td style="padding:28px 24px;">${options.body}</td></tr>
      <tr><td style="padding:20px 24px;background:${BRAND.lightGrey};border-top:1px solid ${BRAND.border};font-size:12px;line-height:1.6;color:${BRAND.mediumGrey};">
        Shipped in plain, unbranded packaging.<br>
        Questions? Just reply to this email.<br>
        <a href="${siteUrl()}" style="color:${BRAND.mediumGrey};">${siteUrl().replace(/^https?:\/\//, '')}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND.pink};border-radius:8px;">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.darkGrey};">${escapeHtml(text)}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.mediumGrey};">${text}</p>`;
}

interface EmailOrder {
  id: string;
  orderNumber: string;
  email: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  couponCode: string | null;
  shippingMethod: string | null;
  estimatedDeliveryAt: Date | null;
  giftNote: string | null;
  items: {
    productName: string;
    variantName: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
}

/** Line items plus totals. Shared by the confirmation email and the receipt. */
function itemsTable(order: EmailOrder): string {
  const rows = order.items
    .map(
      (item) => `<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;">
    <strong style="color:${BRAND.darkGrey};">${escapeHtml(item.productName)}</strong><br>
    <span style="color:${BRAND.mediumGrey};font-size:13px;">${escapeHtml(item.variantName)} &middot; Qty ${item.quantity}</span>
  </td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;white-space:nowrap;">${money(item.totalCents)}</td>
</tr>`,
    )
    .join('');

  const totalRow = (label: string, value: string, bold = false) =>
    `<tr>
  <td style="padding:5px 0;font-size:${bold ? '16px' : '14px'};${bold ? `font-weight:700;color:${BRAND.darkGrey};` : `color:${BRAND.mediumGrey};`}">${label}</td>
  <td align="right" style="padding:5px 0;font-size:${bold ? '16px' : '14px'};white-space:nowrap;${bold ? `font-weight:700;color:${BRAND.darkGrey};` : `color:${BRAND.mediumGrey};`}">${value}</td>
</tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
${rows}
<tr><td colspan="2" style="height:12px;"></td></tr>
${totalRow('Subtotal', money(order.subtotalCents))}
${order.discountCents > 0 ? totalRow(`Discount${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ''}`, `-${money(order.discountCents)}`) : ''}
${totalRow(order.shippingMethod ? escapeHtml(order.shippingMethod) : 'Shipping', order.shippingCents === 0 ? 'Free' : money(order.shippingCents))}
${totalRow('Sales tax', money(order.taxCents))}
<tr><td colspan="2" style="border-top:1px solid ${BRAND.border};height:10px;"></td></tr>
${totalRow('Total', money(order.totalCents), true)}
</table>`;
}

async function loadOrder(orderId: string): Promise<EmailOrder | null> {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      email: true,
      currency: true,
      subtotalCents: true,
      discountCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      couponCode: true,
      shippingMethod: true,
      estimatedDeliveryAt: true,
      giftNote: true,
      items: {
        select: {
          productName: true,
          variantName: true,
          quantity: true,
          unitPriceCents: true,
          totalCents: true,
        },
      },
    },
  });
}

/**
 * Sends and timelines in one call.
 *
 * An email nobody can prove was sent is the second-most-common support ticket
 * after "where is my order", so every send writes an `EMAIL_SENT` event.
 */
async function deliver(
  orderId: string,
  to: string,
  subject: string,
  preheader: string,
  body: string,
  kind: string,
): Promise<boolean> {
  const result = await sendEmail({
    to,
    subject,
    html: layout({ title: subject, preheader, body }),
  });

  if (!result.ok) {
    logger.warn('email.failed', { orderId, kind });
    return false;
  }

  await recordEvent(orderId, 'EMAIL_SENT', `${subject} sent to ${to}.`, {
    data: { kind, messageId: result.id },
    isCustomerVisible: false,
  });

  return true;
}

const trackUrl = (orderNumber: string, email: string) =>
  `${siteUrl()}/orders/lookup?order=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`;

/**
 * Builds the confirmation email without sending it.
 *
 * Separated so the content is verifiable — that the total is right, that the
 * subject stays discreet — without a Resend key or a delivered message. The
 * discretion rules in particular are a product requirement, and a requirement
 * nothing checks is a requirement that quietly stops being true.
 */
export async function renderOrderConfirmation(
  orderId: string,
): Promise<{ subject: string; preheader: string; html: string; to: string } | null> {
  const order = await loadOrder(orderId);
  if (!order) return null;

  const body = orderConfirmationBody(order);
  const subject = `Order ${order.orderNumber} confirmed`;
  const preheader = 'We have your order and are getting it ready.';

  return {
    subject,
    preheader,
    to: order.email,
    html: layout({ title: subject, preheader, body }),
  };
}

function orderConfirmationBody(order: EmailOrder): string {

  const delivery = order.estimatedDeliveryAt
    ? order.estimatedDeliveryAt.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return `
${heading('Your order is confirmed')}
${paragraph(`Thanks — we have your order <strong>${escapeHtml(order.orderNumber)}</strong> and we are getting it ready.`)}
${delivery ? paragraph(`Estimated delivery: <strong>${escapeHtml(delivery)}</strong>.`) : ''}
${itemsTable(order)}
${order.giftNote ? paragraph(`<strong>Gift note:</strong> ${escapeHtml(order.giftNote)}`) : ''}
${button(trackUrl(order.orderNumber, order.email), 'Track your order')}
${paragraph('Everything ships in a plain box with no branding, and the sender name on the label is discreet.')}`;
}

export async function sendOrderConfirmation(orderId: string): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order) return false;

  return deliver(
    orderId,
    order.email,
    `Order ${order.orderNumber} confirmed`,
    'We have your order and are getting it ready.',
    orderConfirmationBody(order),
    'order_confirmation',
  );
}

export async function sendShippingNotification(
  orderId: string,
  shipment: { carrier: string; trackingNumber: string | null; trackingUrl: string | null },
): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order) return false;

  const body = `
${heading('Your order is on its way')}
${paragraph(`Order <strong>${escapeHtml(order.orderNumber)}</strong> shipped today via ${escapeHtml(shipment.carrier)}.`)}
${
  shipment.trackingNumber
    ? paragraph(`Tracking number: <strong>${escapeHtml(shipment.trackingNumber)}</strong>`)
    : ''
}
${button(shipment.trackingUrl ?? trackUrl(order.orderNumber, order.email), 'Track your package')}
${paragraph('The package is plain and unbranded, and nothing on the outside describes what is inside.')}`;

  return deliver(
    orderId,
    order.email,
    `Order ${order.orderNumber} has shipped`,
    'Your package is on its way.',
    body,
    'shipping_notification',
  );
}

export async function sendDeliveryConfirmation(orderId: string): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order) return false;

  const body = `
${heading('Delivered')}
${paragraph(`Order <strong>${escapeHtml(order.orderNumber)}</strong> was delivered. We hope you love it.`)}
${button(`${siteUrl()}/account/orders`, 'Leave a review')}
${paragraph('Something not right? Reply to this email and a real person will sort it out.')}`;

  return deliver(
    orderId,
    order.email,
    `Order ${order.orderNumber} delivered`,
    'Your order arrived.',
    body,
    'delivery_confirmation',
  );
}

export async function sendCancellationEmail(orderId: string, reason?: string): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order) return false;

  const body = `
${heading('Your order was cancelled')}
${paragraph(`Order <strong>${escapeHtml(order.orderNumber)}</strong> has been cancelled${reason ? `: ${escapeHtml(reason)}` : '.'}`)}
${paragraph(`If you were charged, ${money(order.totalCents)} will be back on your original payment method within 5–10 business days.`)}
${button(siteUrl(), 'Continue shopping')}`;

  return deliver(
    orderId,
    order.email,
    `Order ${order.orderNumber} cancelled`,
    'Your order has been cancelled.',
    body,
    'cancellation',
  );
}

export async function sendRefundEmail(orderId: string, amountCents: number): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order) return false;

  const isPartial = amountCents < order.totalCents;

  const body = `
${heading(isPartial ? 'Partial refund issued' : 'Refund issued')}
${paragraph(`We have refunded <strong>${money(amountCents)}</strong> for order <strong>${escapeHtml(order.orderNumber)}</strong>.`)}
${paragraph('It should appear on your original payment method within 5–10 business days, depending on your bank.')}
${button(trackUrl(order.orderNumber, order.email), 'View your order')}`;

  return deliver(
    orderId,
    order.email,
    `Refund for order ${order.orderNumber}`,
    `${money(amountCents)} is on its way back to you.`,
    body,
    'refund',
  );
}

/**
 * Double opt-in confirmation.
 *
 * Not tied to an order, so it does not use `deliver`. Nobody is added to a
 * marketing list until they click the link — a ticked box on a checkout form is
 * a weaker consent record than a click from the inbox itself.
 */
export async function sendNewsletterConfirmation(email: string): Promise<boolean> {
  const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (!subscriber || subscriber.confirmedAt) return false;

  const body = `
${heading('Confirm your subscription')}
${paragraph('Tap below to start getting new arrivals, guides and the occasional offer. Nothing explicit in the subject line, ever.')}
${button(`${siteUrl()}/newsletter/confirm?token=${subscriber.token}`, 'Confirm subscription')}
${paragraph('If you did not sign up, ignore this email and nothing further will be sent.')}`;

  const result = await sendEmail({
    to: email,
    subject: 'Confirm your subscription',
    html: layout({ title: 'Confirm your subscription', preheader: 'One tap to confirm.', body }),
  });

  return result.ok;
}
