'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { PERMISSIONS } from '@/constants/permissions';
import type { OrderStatus } from '@/generated/prisma/enums';
import { withAdminAction } from '@/server/auth/admin';
import { addStaffNote, setCustomerTags } from '@/services/admin/commerce-admin.service';
import { shipAndCapture } from '@/services/admin/fulfilment.service';
import { issueGiftCard } from '@/services/gift-card.service';
import { transitionOrder } from '@/services/order.service';

/**
 * Order and customer actions.
 *
 * State changes route through `transitionOrder` from phase 4, which already
 * owns the rules — which transitions are legal, when stock is released, which
 * emails fire. A second implementation here so the admin could have its own
 * would be two state machines that drift, and the one that drifts is always
 * the one nobody is testing.
 */

/** Which transitions each permission may perform. */
const FULFILMENT: OrderStatus[] = ['PROCESSING', 'SHIPPED', 'DELIVERED'];
const CANCELLATION: OrderStatus[] = ['CANCELLED'];

export async function transitionOrderAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  const status = String(formData.get('status') ?? '') as OrderStatus;
  if (!orderId || !status) return;

  /*
   * The permission is chosen by the destination, not by the form.
   *
   * A hidden field naming its own permission would let anyone who can post to
   * this endpoint pick the cheapest one — and a server action is a public HTTP
   * endpoint however friendly the syntax looks.
   */
  const permission = CANCELLATION.includes(status)
    ? PERMISSIONS.orderCancel
    : FULFILMENT.includes(status)
      ? PERMISSIONS.orderFulfil
      : PERMISSIONS.orderWrite;

  await withAdminAction(
    permission,
    (actor) => transitionOrder(orderId, status, { actorId: actor.id, message: 'Changed in admin' }),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'Order',
      entityId: result.id,
      changes: { status: { from: null, to: status } },
    }),
  );

  revalidatePath('/admin/orders');
  revalidatePath('/admin');
}

/**
 * Records a shipment and moves the order to SHIPPED.
 *
 * Three steps, deliberately in this order: the shipment, then the Klarna
 * capture, then the status change.
 *
 * The shipment goes first so a customer who gets the "your order has shipped"
 * email can already find the tracking number when they click through — the
 * reverse order sends them to an empty timeline. The capture is next because
 * Klarna authorises at checkout and is only permitted to be captured once goods
 * ship; `shipAndCapture` owns that pairing and never rolls the shipment back
 * over a capture failure, because the parcel is physically gone by then.
 */
export async function fulfilOrderAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  if (!orderId) return;

  const carrier = String(formData.get('carrier') ?? 'USPS') as
    'USPS' | 'UPS' | 'FEDEX' | 'DHL' | 'OTHER';

  await withAdminAction(
    PERMISSIONS.orderFulfil,
    async (actor) => {
      const { shipment } = await shipAndCapture({
        orderId,
        carrier,
        service: String(formData.get('service') ?? '') || null,
        trackingNumber: String(formData.get('trackingNumber') ?? '') || null,
        actorId: actor.id,
      });

      await transitionOrder(orderId, 'SHIPPED', {
        actorId: actor.id,
        message: 'Fulfilled in admin',
      });

      return shipment;
    },
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'Shipment',
      entityId: result.id,
      changes: {
        carrier: { from: null, to: result.carrier },
        trackingNumber: { from: null, to: result.trackingNumber },
      },
    }),
  );

  revalidatePath('/admin/orders');
  revalidatePath('/admin');
}

export async function addOrderNoteAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!orderId || !body) return;

  await withAdminAction(
    PERMISSIONS.orderWrite,
    (actor) =>
      addStaffNote({
        orderId,
        authorId: actor.id,
        body,
        isPinned: formData.get('isPinned') === 'on',
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'StaffNote',
      entityId: result.id,
      changes: { orderId: { from: null, to: orderId } },
    }),
  );

  revalidatePath('/admin/orders');
}

export async function addCustomerNoteAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!userId || !body) return;

  await withAdminAction(
    PERMISSIONS.customerWrite,
    (actor) =>
      addStaffNote({
        userId,
        authorId: actor.id,
        body,
        isPinned: formData.get('isPinned') === 'on',
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'StaffNote',
      entityId: result.id,
      changes: { userId: { from: null, to: userId } },
    }),
  );

  revalidatePath(`/admin/customers/${userId}`);
}

/**
 * Issues a gift card and returns the code once.
 *
 * The code is shown to the issuer on the next screen and never again — only its
 * hash is stored, so nobody, including staff, can read it back. That is the
 * same trade as a password, for the same reason: it is a bearer instrument, and
 * a leaked database should not be a stack of cash.
 */
export async function issueGiftCardAction(formData: FormData): Promise<void> {
  const dollars = Number(formData.get('amount') ?? 0);
  const amountCents = Math.round(dollars * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return;

  const expiresRaw = String(formData.get('expiresAt') ?? '');

  const issued = await withAdminAction(
    PERMISSIONS.creditIssue,
    (actor) =>
      issueGiftCard({
        amountCents,
        issuedToEmail: String(formData.get('email') ?? '') || null,
        note: String(formData.get('note') ?? '') || null,
        expiresAt: expiresRaw ? new Date(expiresRaw) : null,
        issuedById: actor.id,
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'GiftCard',
      entityId: result.id,
      // The amount and the last four, never the code — an audit log is the last
      // place a bearer instrument should be written down.
      changes: {
        amountCents: { from: null, to: amountCents },
        last4: { from: null, to: result.last4 },
      },
    }),
  );

  revalidatePath('/admin/promotions');
  // The code travels once, in the URL, so the issuer can copy it. It is not
  // recoverable afterwards.
  redirect(`/admin/promotions?issued=${encodeURIComponent(issued.code)}`);
}

export async function setCustomerTagsAction(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  if (!userId) return;

  const tags = String(formData.get('tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  await withAdminAction(
    PERMISSIONS.customerWrite,
    () => setCustomerTags(userId, tags),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'User',
      entityId: userId,
      changes: { adminTags: { from: null, to: tags } },
    }),
  );

  revalidatePath(`/admin/customers/${userId}`);
  revalidatePath('/admin/customers');
}
