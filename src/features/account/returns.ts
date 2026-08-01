import type { ReturnStatus } from '@/generated/prisma/enums';

/**
 * Customer-facing copy for each return status.
 *
 * Here rather than in `return.service` because client components render it, and
 * that service is `server-only` — importing it from the browser would drag Prisma
 * into the bundle. Enums are types, so they erase; this is a value, so it needs a
 * home on the client side of the line.
 */
export const RETURN_STATUS_COPY: Record<
  ReturnStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger'; description: string }
> = {
  REQUESTED: {
    label: 'Requested',
    tone: 'warning',
    description: 'We have your request and will review it within two working days.',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'success',
    description: 'Send the items back using the instructions we emailed you.',
  },
  REJECTED: {
    label: 'Not approved',
    tone: 'danger',
    description: 'We could not approve this return. Reply to the email if you disagree.',
  },
  IN_TRANSIT: {
    label: 'On its way back',
    tone: 'info',
    description: 'We are waiting for it to arrive.',
  },
  RECEIVED: { label: 'Received', tone: 'info', description: 'We have it and are checking it over.' },
  REFUNDED: { label: 'Refunded', tone: 'success', description: 'Your refund is on its way.' },
  CANCELLED: { label: 'Cancelled', tone: 'info', description: 'This return was cancelled.' },
};
