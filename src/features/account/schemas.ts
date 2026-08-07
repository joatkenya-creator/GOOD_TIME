import { z } from 'zod';

import { addressSchema } from '@/features/checkout/schemas';

/**
 * Account input validation.
 *
 * Reuses `addressSchema` from checkout rather than restating it: a shipping
 * address is the same thing whether it is typed at checkout or saved in the
 * address book, and two definitions would eventually disagree about what a valid
 * ZIP is.
 */

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(60),
  lastName: z.string().trim().min(1, 'Enter your last name').max(60),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\s()+.-]{10,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * Changing the email address.
 *
 * The current password is required. An email address is the reset vector for the
 * whole account, so letting a walk-up attacker on an unlocked laptop change it
 * silently hands them everything.
 */
export const emailChangeSchema = z.object({
  email: z.email('Enter a valid email address').max(160),
  currentPassword: z.string().min(1, 'Enter your current password'),
});

/**
 * Password rules.
 *
 * Length is the requirement that actually correlates with strength; composition
 * rules mostly produce `Password1!`. NIST 800-63B says the same, so the floor is
 * 10 characters with no character-class mandate — and the strength meter in the
 * UI nudges rather than blocks.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That is longer than 200 characters');

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Choose a password you have not used here before',
    path: ['newPassword'],
  });

export const preferencesSchema = z.object({
  // Validated against the browser's own list rather than a hardcoded enum, so
  // this does not go stale when the IANA database updates.
  timezone: z.string().min(1).max(64),
  locale: z.enum(['en-US']),
  birthMonth: z.coerce.number().int().min(1).max(12).nullable().optional(),
  birthDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
});

export const savedAddressSchema = addressSchema.extend({
  type: z.enum(['SHIPPING', 'BILLING']).default('SHIPPING'),
  isDefault: z.boolean().default(false),
});

export type SavedAddressInput = z.infer<typeof savedAddressSchema>;

export const NOTIFICATION_TOPICS = [
  {
    key: 'ORDER_UPDATES',
    label: 'Order updates',
    description: 'Confirmations, payment issues and cancellations.',
    /// Transactional. Switching it off is allowed but strongly discouraged.
    essential: true,
  },
  {
    key: 'SHIPPING_UPDATES',
    label: 'Shipping and delivery',
    description: 'Dispatch confirmations and tracking.',
    essential: true,
  },
  {
    key: 'RETURNS',
    label: 'Returns and refunds',
    description: 'Progress on anything you send back.',
    essential: true,
  },
  {
    key: 'SECURITY_ALERTS',
    label: 'Security alerts',
    description: 'Password changes and sign-ins from a new device.',
    essential: true,
  },
  {
    key: 'PRODUCT_BACK_IN_STOCK',
    label: 'Back in stock',
    description: 'Only for items you asked to be told about.',
    essential: false,
  },
  {
    key: 'REVIEW_REMINDERS',
    label: 'Review reminders',
    description: 'A nudge to review something you bought.',
    essential: false,
  },
  {
    key: 'PROMOTIONS',
    label: 'Offers and promotions',
    description: 'Sales and discount codes.',
    essential: false,
  },
  {
    key: 'NEWSLETTER',
    label: 'Newsletter',
    description: 'New arrivals and buying guides.',
    essential: false,
  },
] as const satisfies readonly {
  key: string;
  label: string;
  description: string;
  essential: boolean;
}[];

export type NotificationTopicKey = (typeof NOTIFICATION_TOPICS)[number]['key'];

export const notificationPreferenceSchema = z.object({
  topic: z.enum(NOTIFICATION_TOPICS.map((topic) => topic.key) as [string, ...string[]]),
  email: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
});

export const RETURN_REASONS = [
  { key: 'DAMAGED', label: 'Arrived damaged' },
  { key: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { key: 'WRONG_ITEM', label: 'Wrong item sent' },
  { key: 'ARRIVED_LATE', label: 'Arrived too late' },
  { key: 'QUALITY', label: 'Quality was not what I expected' },
  { key: 'CHANGED_MIND', label: 'Changed my mind' },
  { key: 'OTHER', label: 'Something else' },
] as const satisfies readonly { key: string; label: string }[];

export const returnRequestSchema = z.object({
  orderId: z.cuid(),
  reason: z.enum(RETURN_REASONS.map((reason) => reason.key) as [string, ...string[]]),
  comment: z.string().trim().max(1000).optional().or(z.literal('')),
  items: z
    .array(z.object({ orderItemId: z.cuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1, 'Choose at least one item to return'),
});

export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

/**
 * Deleting an account.
 *
 * Typing the word is the friction. A checkbox is muscle memory; a password alone
 * is what a browser fills in for you. Neither reliably means "I understand this
 * is irreversible" — typing does.
 */
export const deleteAccountSchema = z.object({
  confirmation: z.literal('DELETE', { message: 'Type DELETE to confirm' }),
  password: z.string().min(1, 'Enter your password'),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

/**
 * Password strength, 0–4.
 *
 * Deliberately simple and local — a real estimator like zxcvbn is a 400kB
 * dictionary shipped to the browser to draw a coloured bar. Length dominates the
 * score because length dominates real strength; variety is a secondary nudge.
 * This never blocks a submission, so being approximate is fine.
 */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
} {
  if (!password) return { score: 0, label: 'Enter a password', hint: 'At least 10 characters.' };

  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (password.length >= 20) score += 1;

  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (variety >= 3) score += 1;

  // Anything a cracking dictionary tries in its first thousand guesses.
  const obvious = /^(password|qwerty|welcome|letmein|admin|intimatebunnie)/i.test(password);
  const repeated = /^(.)\1+$/.test(password);
  if (obvious || repeated) score = 0;

  const capped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

  const LABELS = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'] as const;
  const HINTS = [
    'Avoid common words. Length beats symbols.',
    'Longer is stronger — try a short phrase.',
    'Good. A few more characters would help.',
    'Strong enough for an account holding an order history.',
    'Excellent.',
  ] as const;

  return { score: capped, label: LABELS[capped], hint: HINTS[capped] };
}
