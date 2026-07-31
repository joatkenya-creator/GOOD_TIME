import { z } from 'zod';

/**
 * Checkout input validation.
 *
 * These schemas run on both sides of the wire: React Hook Form uses them for
 * inline errors, and every route handler and server action re-parses with the
 * same schema. Client-side validation is a convenience, never a control.
 */

/** The 50 states plus DC and the territories we ship to. */
export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'],
  ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const satisfies readonly (readonly [string, string])[];

const STATE_CODES = US_STATES.map(([code]) => code);

export const addressSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(60),
  lastName: z.string().trim().min(1, 'Enter a last name').max(60),
  company: z.string().trim().max(80).optional().or(z.literal('')),
  line1: z.string().trim().min(1, 'Enter a street address').max(120),
  line2: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Enter a city').max(80),
  state: z.enum(STATE_CODES as [string, ...string[]], { message: 'Choose a state' }),
  // 12345 or 12345-6789. Rejecting anything else here saves an undeliverable
  // shipment later; the carrier will not be lenient about it.
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  country: z.literal('US').default('US'),
  phone: z
    .string()
    .trim()
    .regex(/^[\d\s()+.-]{10,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
});

export type AddressInput = z.infer<typeof addressSchema>;

export const contactSchema = z.object({
  email: z.email('Enter a valid email address').max(160),
  /** Opt-in, unchecked by default — an unticked box is not consent. */
  subscribe: z.boolean().default(false),
});

export const checkoutSchema = z.object({
  email: z.email('Enter a valid email address').max(160),
  subscribe: z.boolean().default(false),
  shippingAddress: addressSchema,
  /** Absent means "same as shipping", which is what most customers want. */
  billingAddress: addressSchema.optional(),
  billingSameAsShipping: z.boolean().default(true),
  shippingRateId: z.cuid('Choose a delivery method'),
  customerNote: z.string().trim().max(500).optional().or(z.literal('')),
  saveAddress: z.boolean().default(false),
  /** Required, and explicitly not pre-ticked — this store sells adult products. */
  ageConfirmed: z.literal(true, { message: 'You must confirm you are 18 or older' }),
  acceptTerms: z.literal(true, { message: 'You must accept the terms to order' }),
});

/** What the server receives and acts on — defaults applied. */
export type CheckoutInput = z.output<typeof checkoutSchema>;

/**
 * What the form holds while it is being filled in.
 *
 * Distinct from `CheckoutInput` because `.default()` makes a field optional on
 * the way in and guaranteed on the way out. React Hook Form is generic over both,
 * and conflating them is what makes `zodResolver` refuse to typecheck.
 */
export type CheckoutFormValues = z.input<typeof checkoutSchema>;

export const couponSchema = z.object({
  code: z.string().trim().min(2, 'Enter a code').max(40),
});

export const estimateSchema = z.object({
  state: z.enum(STATE_CODES as [string, ...string[]]),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code')
    .optional(),
});

export const giftNoteSchema = z.object({
  note: z.string().trim().max(500),
});

export const cartItemSchema = z.object({
  variantId: z.cuid(),
  quantity: z.number().int().min(1).max(99),
});

/** Guest order lookup: the number alone is guessable, so email is mandatory. */
export const orderLookupSchema = z.object({
  orderNumber: z.string().trim().regex(/^GT-\d{4,}$/i, 'Enter an order number like GT-100042'),
  email: z.email('Enter the email used on the order'),
});
