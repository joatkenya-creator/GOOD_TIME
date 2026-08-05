/**
 * Test fixtures.
 *
 * ## Realistic, not minimal
 *
 * Every value here is one a real shop would produce: prices that do not divide
 * evenly, a discount that rounds, an address with a unit number, a name with an
 * apostrophe, an order with mixed line types. Minimal fixtures — `price: 100`,
 * `name: 'Test'` — pass tests that a real basket breaks, because the bugs live
 * in the rounding, the escaping and the edge case, and a round number has none
 * of those.
 *
 * ## Builders, not constants
 *
 * Each factory takes overrides so a test can change one field and inherit the
 * rest. Shared mutable constants leak state between tests in ways that surface
 * as an unrelated failure three files later.
 */

let sequence = 0;

/** Deterministic ids. Random ones make a failure impossible to reproduce. */
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${String(sequence).padStart(6, '0')}`;
}

export function resetFixtureSequence(): void {
  sequence = 0;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface VariantFixture {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  compareAtCents: number | null;
  inventory: { quantity: number; reserved: number; lowStockThreshold: number };
}

export function aVariant(overrides: Partial<VariantFixture> = {}): VariantFixture {
  return {
    id: nextId('var'),
    sku: 'GT-LUM-ROSE-M',
    name: 'Rose / Medium',
    // 4499, not 4500: a price ending in 99 is what actually ships, and it is
    // the one that exposes rounding in tax and percentage discounts.
    priceCents: 4499,
    compareAtCents: 5999,
    inventory: { quantity: 42, reserved: 3, lowStockThreshold: 5 },
    ...overrides,
  };
}

export interface ProductFixture {
  id: string;
  slug: string;
  name: string;
  description: string;
  isPublished: boolean;
  variants: VariantFixture[];
  imageUrl: string;
}

export function aProduct(overrides: Partial<ProductFixture> = {}): ProductFixture {
  return {
    id: nextId('prod'),
    slug: 'lumen-silk-chemise',
    // An apostrophe and an ampersand, because both break naive HTML templating
    // and both appear in real product names.
    name: "Lumen Silk Chemise — Women's & Petite",
    description: 'Mulberry silk, French seams, adjustable straps.',
    isPublished: true,
    variants: [aVariant()],
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/products/lumen.jpg',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderItemFixture {
  id: string;
  sku: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  imageUrl: string | null;
}

export function anOrderItem(overrides: Partial<OrderItemFixture> = {}): OrderItemFixture {
  const quantity = overrides.quantity ?? 2;
  const unitPriceCents = overrides.unitPriceCents ?? 4499;
  /*
   * A 15% discount on 8998 is 1349.7 — it does not divide evenly, which is
   * precisely the case that makes order lines fail to sum to the total.
   */
  const discountCents = overrides.discountCents ?? 1350;

  return {
    id: nextId('item'),
    sku: 'GT-LUM-ROSE-M',
    productName: "Lumen Silk Chemise — Women's & Petite",
    variantName: 'Rose / Medium',
    quantity,
    unitPriceCents,
    discountCents,
    taxCents: 0,
    totalCents: unitPriceCents * quantity - discountCents,
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/products/lumen.jpg',
    ...overrides,
  };
}

export interface AddressFixture {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
}

export function anAddress(overrides: Partial<AddressFixture> = {}): AddressFixture {
  return {
    firstName: 'Ada',
    lastName: "O'Sullivan",
    line1: '1 Analytical Way',
    line2: 'Apt 4B',
    city: 'Los Angeles',
    state: 'CA',
    postalCode: '90013',
    country: 'US',
    phone: '+13105550142',
    ...overrides,
  };
}

export interface OrderFixture {
  id: string;
  orderNumber: string;
  email: string;
  userId: string | null;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  creditAppliedCents: number;
  paidAt: Date | null;
  items: OrderItemFixture[];
  shippingAddressSnapshot: AddressFixture;
  billingAddressSnapshot: AddressFixture | null;
}

/**
 * A whole order whose totals actually add up.
 *
 * Derived rather than hard-coded so an override to a line item cannot leave the
 * fixture internally inconsistent — which would make a test about summing
 * assert against a fixture that was already wrong.
 */
export function anOrder(overrides: Partial<OrderFixture> = {}): OrderFixture {
  const items = overrides.items ?? [anOrderItem()];
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const discountCents = items.reduce((sum, item) => sum + item.discountCents, 0);
  const shippingCents = overrides.shippingCents ?? 795;
  // 9.5% Los Angeles County, applied to the discounted subtotal plus shipping.
  const taxable = subtotalCents - discountCents + shippingCents;
  const taxCents = overrides.taxCents ?? Math.round(taxable * 0.095);

  const totalCents = overrides.totalCents ?? taxable + taxCents;

  return {
    id: nextId('order'),
    orderNumber: `GT-1${String(100_000 + sequence).slice(1)}`,
    email: 'ada@example.test',
    userId: null,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    currency: 'USD',
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    totalCents,
    creditAppliedCents: 0,
    paidAt: null,
    items,
    shippingAddressSnapshot: anAddress(),
    billingAddressSnapshot: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Klarna
// ---------------------------------------------------------------------------

export interface KlarnaOrderFixture {
  order_id: string;
  status: 'AUTHORIZED' | 'PART_CAPTURED' | 'CAPTURED' | 'CANCELLED' | 'EXPIRED' | 'CLOSED';
  fraud_status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
  order_amount: number;
  original_order_amount: number;
  captured_amount: number;
  refunded_amount: number;
  remaining_authorized_amount: number;
  purchase_currency: string;
  merchant_reference1?: string;
  expires_at?: string;
}

/** A Klarna order as it exists immediately after a successful authorisation. */
export function aKlarnaOrder(overrides: Partial<KlarnaOrderFixture> = {}): KlarnaOrderFixture {
  const amount = overrides.order_amount ?? 8443;

  return {
    order_id: nextId('klarna'),
    status: 'AUTHORIZED',
    fraud_status: 'ACCEPTED',
    order_amount: amount,
    original_order_amount: amount,
    captured_amount: 0,
    refunded_amount: 0,
    remaining_authorized_amount: amount,
    purchase_currency: 'USD',
    // 28 days, Klarna's default authorisation window.
    expires_at: new Date(Date.now() + 28 * 86_400_000).toISOString(),
    ...overrides,
  };
}

/** The session response, as returned by `POST /payments/v1/sessions`. */
export function aKlarnaSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: nextId('session'),
    client_token: 'eyJhbGciOiJSUzI1NiJ9.eyJzZXNzaW9uX2lkIjoiZmFrZSJ9.signature',
    payment_method_categories: [
      { identifier: 'pay_later', name: 'Pay in 30 days' },
      { identifier: 'pay_over_time', name: 'Pay in 4 interest-free payments' },
    ],
    ...overrides,
  };
}

/** Klarna's error envelope. Every 4xx and 5xx carries this shape. */
export function aKlarnaError(errorCode: string, messages: string[] = []) {
  return { error_code: errorCode, error_messages: messages, correlation_id: nextId('corr') };
}
