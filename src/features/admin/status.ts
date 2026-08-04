import type {
  OrderStatus,
  PaymentStatus,
  PostStatus,
  ProductStatus,
  ReturnStatus,
} from '@/generated/prisma/enums';

/**
 * One status vocabulary for the whole admin.
 *
 * Colour carries meaning here — green is settled, amber needs attention, red is
 * wrong — and defining it per module is how "cancelled" ends up amber on one
 * screen and red on the next. Every pill also renders its label as text, so the
 * colour is reinforcement rather than the only signal.
 */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING: 'warning',
  PAID: 'info',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'danger',
  RETURNED: 'warning',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  PENDING: 'warning',
  AUTHORIZED: 'info',
  PAID: 'success',
  PARTIALLY_REFUNDED: 'warning',
  REFUNDED: 'danger',
  FAILED: 'danger',
};

export const PRODUCT_STATUS_TONE: Record<ProductStatus, Tone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  ARCHIVED: 'warning',
};

export const POST_STATUS_TONE: Record<PostStatus, Tone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

export const RETURN_STATUS_TONE: Record<ReturnStatus, Tone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  IN_TRANSIT: 'info',
  RECEIVED: 'info',
  REFUNDED: 'success',
  CANCELLED: 'neutral',
};

/**
 * The four product states the admin talks about, from the two the database
 * stores.
 *
 * "Scheduled" is not a fourth enum value, deliberately. It is `DRAFT` plus a
 * future `publishedAt`, which is the same fact expressed once rather than
 * twice — and a separate enum value would need a job to flip it, plus a
 * reconciliation for every row the job missed. Derived, it is simply true the
 * moment the clock passes.
 */
export type DisplayProductStatus = 'Draft' | 'Scheduled' | 'Published' | 'Archived';

export function displayProductStatus(
  status: ProductStatus,
  publishedAt: Date | null,
): { label: DisplayProductStatus; tone: Tone } {
  if (status === 'ARCHIVED') return { label: 'Archived', tone: 'warning' };

  if (status === 'ACTIVE') {
    return publishedAt && publishedAt.getTime() > Date.now()
      ? { label: 'Scheduled', tone: 'info' }
      : { label: 'Published', tone: 'success' };
  }

  return publishedAt && publishedAt.getTime() > Date.now()
    ? { label: 'Scheduled', tone: 'info' }
    : { label: 'Draft', tone: 'neutral' };
}

/** Sentence case from an enum: `PARTIALLY_REFUNDED` → `Partially refunded`. */
export function humaniseEnum(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
