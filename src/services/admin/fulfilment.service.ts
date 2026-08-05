import 'server-only';

import type { ShippingCarrier } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { captureForOrder } from '@/services/payment.service';

/**
 * Fulfilment: turning a paid order into a parcel with a tracking number.
 *
 * **No carrier API.** Buying postage means an account, a funding source and a
 * production integration — all explicitly outside this phase. What is here is
 * everything either side of that call: recording which carrier and service went
 * out, deriving the tracking URL, printing a label to stick on the box, and
 * moving the order to `SHIPPED` so the customer is told.
 *
 * When a carrier account arrives, `createShipment` is where the API call goes:
 * it already takes the shape a carrier returns and already writes `labelUrl`,
 * so the integration replaces the manual tracking number rather than the flow
 * around it.
 */

/**
 * Where each carrier's public tracking lives.
 *
 * Built here rather than stored, so a carrier changing its URL scheme is a
 * one-line fix instead of a migration over every historical shipment.
 */
const TRACKING_URLS: Record<ShippingCarrier, (tracking: string) => string | null> = {
  USPS: (t) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(t)}`,
  UPS: (t) => `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`,
  FEDEX: (t) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}`,
  DHL: (t) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(t)}`,
  // An unknown carrier has no known URL. Better to show the bare number than to
  // send a customer to a page that cannot find it.
  OTHER: () => null,
};

export function trackingUrlFor(carrier: ShippingCarrier, tracking: string): string | null {
  return TRACKING_URLS[carrier](tracking);
}

export const CARRIERS: { value: ShippingCarrier; label: string }[] = [
  { value: 'USPS', label: 'USPS' },
  { value: 'UPS', label: 'UPS' },
  { value: 'FEDEX', label: 'FedEx' },
  { value: 'DHL', label: 'DHL' },
  { value: 'OTHER', label: 'Other' },
];

export interface CreateShipmentInput {
  orderId: string;
  carrier: ShippingCarrier;
  service?: string | null;
  trackingNumber?: string | null;
  costCents?: number | null;
}

/**
 * Records a shipment against an order.
 *
 * The shipment and the order event are written together: a parcel that exists
 * without a timeline entry is one the customer was never told about, and
 * "where is my order" is the most common question support answers.
 *
 * A tracking number is optional — some orders genuinely go out untracked — but
 * the status reflects which one it is, so a warehouse can find the parcels that
 * still need a number.
 */
export async function createShipment(input: CreateShipmentInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, orderNumber: true, status: true },
  });

  if (!order) throw errors.notFound('Order');

  // Shipping something nobody has paid for is a mistake worth blocking rather
  // than recording.
  if (order.status === 'PENDING') {
    throw errors.badRequest('That order has not been paid for yet.');
  }

  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    throw errors.badRequest(`That order is ${order.status.toLowerCase()}.`);
  }

  const tracking = input.trackingNumber?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        orderId: order.id,
        carrier: input.carrier,
        service: input.service?.trim() || null,
        trackingNumber: tracking,
        trackingUrl: tracking ? trackingUrlFor(input.carrier, tracking) : null,
        costCents: input.costCents ?? null,
        status: tracking ? 'IN_TRANSIT' : 'LABEL_CREATED',
        shippedAt: new Date(),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'FULFILLMENT_UPDATED',
        message: tracking
          ? `Shipped via ${input.carrier}${input.service ? ` ${input.service}` : ''} — ${tracking}`
          : `Shipped via ${input.carrier}${input.service ? ` ${input.service}` : ''}`,
        data: { shipmentId: shipment.id, carrier: input.carrier, trackingNumber: tracking },
      },
    });

    return shipment;
  });
}

/**
 * Records a shipment and takes the money for it.
 *
 * Klarna authorises at checkout and is captured at fulfilment — that is its
 * merchant model, not a preference — so the capture belongs here, at the moment
 * goods actually leave. Anything that ships without passing through this
 * function ships against an authorisation nobody ever converted into revenue.
 *
 * The capture is deliberately *after* the shipment is committed, and its
 * failure does not roll the shipment back. The parcel is physically gone by the
 * time this runs; pretending otherwise would leave the warehouse and the
 * database disagreeing about reality. A failed capture is logged, recorded on
 * the order timeline, and picked up by the nightly reconcile — money is
 * recoverable, a lost shipment record is not.
 */
export async function shipAndCapture(input: CreateShipmentInput & { actorId?: string | null }) {
  const shipment = await createShipment(input);

  try {
    const { amountCents, captureId } = await captureForOrder(input.orderId, {
      description: input.trackingNumber
        ? `Shipped ${input.carrier} ${input.trackingNumber}`
        : `Shipped ${input.carrier}`,
      actorId: input.actorId ?? null,
    });

    return { shipment, capture: { amountCents, captureId }, captureError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error('fulfilment.capture_failed', error, { orderId: input.orderId });

    await prisma.orderEvent.create({
      data: {
        orderId: input.orderId,
        type: 'NOTE_ADDED',
        message: `Shipped, but the Klarna capture failed: ${message}`,
        isCustomerVisible: false,
      },
    });

    return { shipment, capture: null, captureError: message };
  }
}

/** Everything a printable label needs, in one query. */
export async function getShipmentForLabel(orderNumber: string) {
  return prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      email: true,
      shippingMethod: true,
      shippingAddressSnapshot: true,
      placedAt: true,
      createdAt: true,
      items: { select: { quantity: true } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

/** Orders that are paid and have nothing shipped yet — the packing queue. */
export async function listAwaitingFulfilment(limit = 50) {
  return prisma.order.findMany({
    where: {
      status: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] },
      shipments: { none: {} },
    },
    orderBy: { placedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      email: true,
      status: true,
      totalCents: true,
      placedAt: true,
      shippingMethod: true,
      _count: { select: { items: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });
}
