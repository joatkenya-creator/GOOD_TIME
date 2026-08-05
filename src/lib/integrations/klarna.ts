import 'server-only';

import { errors } from '@/lib/api/errors';
import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from '@/lib/security/compare';

/**
 * Klarna API client.
 *
 * ## Why raw `fetch` and not an SDK
 *
 * Klarna publishes no first-party Node SDK, and this runs on Cloudflare Workers
 * where the Node HTTP stack is not the one executing. `fetch` plus Basic auth is
 * the documented contract, is ~40 lines, and works identically in dev, in CI and
 * on the edge.
 *
 * ## Authentication
 *
 * HTTP Basic with the API credentials from the Klarna Merchant Portal
 * (Settings → Klarna API credentials). The username is *not* an email; it looks
 * like `PK12345_1a2b3c4d`. Playground and production credentials are different
 * accounts and are not interchangeable — see docs/klarna.md.
 *
 * ## Money
 *
 * Klarna works in the currency's minor unit — cents for USD — which is the unit
 * used everywhere in this codebase. Nothing converts anywhere, so there is no
 * place for a factor-of-100 bug to hide.
 */

/**
 * Regional API hosts. Klarna shards by the merchant account's region, and a
 * request to the wrong host authenticates fine and then 404s on the resource,
 * which is a genuinely confusing way to fail.
 */
const HOSTS = {
  eu: { production: 'https://api.klarna.com', playground: 'https://api.playground.klarna.com' },
  na: {
    production: 'https://api-na.klarna.com',
    playground: 'https://api-na.playground.klarna.com',
  },
  oc: {
    production: 'https://api-oc.klarna.com',
    playground: 'https://api-oc.playground.klarna.com',
  },
} as const;

export type KlarnaRegion = keyof typeof HOSTS;
export type KlarnaEnvironment = 'playground' | 'production';

export function klarnaApiBase(): string {
  return HOSTS[env.KLARNA_REGION][env.KLARNA_ENVIRONMENT];
}

/** The browser SDK is served from a different origin per environment. */
export function klarnaSdkUrl(): string {
  return 'https://x.klarnacdn.net/kp/lib/v1/api.js';
}

function authorization(): string {
  if (!integrations.klarna) throw errors.integrationUnavailable('Klarna');
  // btoa is available in Workers, Node 18+ and the browser; Buffer is not
  // available in the Workers runtime without a compat flag.
  return `Basic ${btoa(`${env.KLARNA_USERNAME}:${env.KLARNA_PASSWORD}`)}`;
}

export class KlarnaError extends Error {
  constructor(
    readonly status: number,
    readonly correlationId: string | null,
    readonly errorCode: string | null,
    readonly messages: string[],
  ) {
    super(
      `Klarna ${status}${errorCode ? ` ${errorCode}` : ''}: ${messages.join('; ') || 'request failed'}`,
    );
    this.name = 'KlarnaError';
  }

  /** 5xx and 429 are worth retrying; a 400 will fail identically forever. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Klarna deduplicates writes carrying the same key for 24 hours. */
  idempotencyKey?: string;
  /** Some responses (capture, cancel) carry the identifier in a header. */
  wantHeaders?: string[];
}

export interface KlarnaResponse<T> {
  data: T;
  headers: Record<string, string>;
  status: number;
}

/**
 * One request against the Klarna API.
 *
 * Retries only what is safely retryable: network failures and 5xx/429, and only
 * for idempotent verbs or writes carrying an idempotency key. A capture retried
 * without a key is a second capture.
 */
export async function klarnaRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<KlarnaResponse<T>> {
  const method = options.method ?? 'GET';

  /*
   * Built once, outside the retry loop, and deliberately not inside the `try`.
   *
   * `authorization()` throws when Klarna is unconfigured. Inside the loop that
   * throw is indistinguishable from a network failure, so it gets retried three
   * times and reported as "Klarna is not responding" — sending an operator to
   * check Klarna's status page over a missing environment variable.
   */
  const authHeader = authorization();
  const url = `${klarnaApiBase()}${path}`;
  const safeToRetry = method === 'GET' || method === 'DELETE' || Boolean(options.idempotencyKey);
  const attempts = safeToRetry ? 3 : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'GOOD-TIME/1.0 (+https://github.com)',
          ...(options.idempotencyKey ? { 'Klarna-Idempotency-Key': options.idempotencyKey } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        // Klarna's p99 sits under two seconds; anything past ten is a hung
        // connection holding a checkout hostage.
        signal: AbortSignal.timeout(10_000),
      });

      const headers: Record<string, string> = {};
      for (const key of options.wantHeaders ?? []) {
        const value = response.headers.get(key);
        if (value) headers[key.toLowerCase()] = value;
      }

      // 204 and 201-with-header responses carry no body.
      const text = await response.text();
      const data = text ? (JSON.parse(text) as T) : (undefined as T);

      if (!response.ok) {
        const payload = (data ?? {}) as { error_code?: string; error_messages?: string[] };
        const error = new KlarnaError(
          response.status,
          response.headers.get('klarna-correlation-id'),
          payload.error_code ?? null,
          payload.error_messages ?? [],
        );

        if (error.retryable && attempt < attempts) {
          lastError = error;
          await backoff(attempt);
          continue;
        }

        throw error;
      }

      return { data, headers, status: response.status };
    } catch (error) {
      if (error instanceof KlarnaError) throw error;

      // Network-level failure: timeout, DNS, connection reset.
      lastError = error;
      if (attempt >= attempts) break;
      await backoff(attempt);
    }
  }

  logger.error('klarna.request_failed', lastError, { path, method });
  throw errors.badGateway('Klarna is not responding. Try again in a moment.');
}

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(2 ** attempt * 150, 2_000);
  // Jitter, so a Klarna blip does not become a thundering herd on recovery.
  return new Promise((resolve) => setTimeout(resolve, ms + Math.random() * ms * 0.3));
}

// ---------------------------------------------------------------------------
// Klarna Payments — session and authorization lifecycle
// ---------------------------------------------------------------------------

export interface KlarnaOrderLine {
  type: 'physical' | 'digital' | 'shipping_fee' | 'sales_tax' | 'discount' | 'gift_card';
  reference?: string;
  name: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total_amount: number;
  total_tax_amount: number;
  image_url?: string;
  product_url?: string;
}

export interface KlarnaAddress {
  given_name?: string;
  family_name?: string;
  email?: string;
  street_address?: string;
  street_address2?: string;
  postal_code?: string;
  city?: string;
  region?: string;
  phone?: string;
  country?: string;
}

export interface CreateSessionInput {
  purchase_country: string;
  purchase_currency: string;
  locale: string;
  order_amount: number;
  order_tax_amount: number;
  order_lines: KlarnaOrderLine[];
  merchant_reference1?: string;
  merchant_urls?: { confirmation?: string; notification?: string; push?: string };
  billing_address?: KlarnaAddress;
  shipping_address?: KlarnaAddress;
}

export interface KlarnaSession {
  session_id: string;
  client_token: string;
  payment_method_categories?: {
    identifier: string;
    name: string;
    asset_urls?: Record<string, string>;
  }[];
}

export function createSession(input: CreateSessionInput): Promise<KlarnaResponse<KlarnaSession>> {
  return klarnaRequest<KlarnaSession>('/payments/v1/sessions', { method: 'POST', body: input });
}

/**
 * Refreshes an existing session in place.
 *
 * Returns 204 with no body. Used when the basket or the address changes between
 * mounting the widget and authorising — Klarna scores the *session*, and an
 * amount that no longer matches the order is rejected at authorisation time
 * with a message the customer cannot act on.
 */
export function updateSession(
  sessionId: string,
  input: CreateSessionInput,
): Promise<KlarnaResponse<void>> {
  return klarnaRequest<void>(`/payments/v1/sessions/${sessionId}`, { method: 'POST', body: input });
}

export function readSession(
  sessionId: string,
): Promise<KlarnaResponse<KlarnaSession & CreateSessionInput>> {
  return klarnaRequest(`/payments/v1/sessions/${sessionId}`);
}

export interface KlarnaPlacedOrder {
  order_id: string;
  redirect_url?: string;
  fraud_status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
  authorized_payment_method?: {
    type: string;
    number_of_days?: number;
    number_of_installments?: number;
  };
}

/**
 * Converts an authorization token into a Klarna order.
 *
 * The token is single-use and expires 60 minutes after the customer authorises.
 * The idempotency key is mandatory in practice: a retried POST without one
 * places a second order against the same customer.
 */
export function placeOrder(
  authorizationToken: string,
  input: CreateSessionInput & { auto_capture?: boolean },
  idempotencyKey: string,
): Promise<KlarnaResponse<KlarnaPlacedOrder>> {
  return klarnaRequest<KlarnaPlacedOrder>(
    `/payments/v1/authorizations/${authorizationToken}/order`,
    { method: 'POST', body: input, idempotencyKey },
  );
}

/** Releases an authorization the customer abandoned, freeing their credit line. */
export function cancelAuthorization(authorizationToken: string): Promise<KlarnaResponse<void>> {
  return klarnaRequest<void>(`/payments/v1/authorizations/${authorizationToken}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Order Management — capture, refund, cancel
// ---------------------------------------------------------------------------

export interface KlarnaManagedOrder {
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
  captures?: { capture_id: string; captured_amount: number; captured_at: string }[];
  refunds?: { refund_id: string; refunded_amount: number; refunded_at: string }[];
}

export function readOrder(orderId: string): Promise<KlarnaResponse<KlarnaManagedOrder>> {
  return klarnaRequest<KlarnaManagedOrder>(`/ordermanagement/v1/orders/${orderId}`);
}

/**
 * Captures funds.
 *
 * Klarna authorises at checkout and captures at fulfilment — that is the whole
 * model, and capturing before you ship is a term-of-service problem, not just a
 * cash-flow one. `shipOrder` in the fulfilment service is what calls this.
 *
 * The capture id comes back in the `Capture-ID` header, not the body.
 */
export async function captureOrder(
  orderId: string,
  amountCents: number,
  options: { description?: string; idempotencyKey: string },
): Promise<{ captureId: string | null }> {
  const response = await klarnaRequest<void>(`/ordermanagement/v1/orders/${orderId}/captures`, {
    method: 'POST',
    body: {
      captured_amount: amountCents,
      ...(options.description ? { description: options.description } : {}),
    },
    idempotencyKey: options.idempotencyKey,
    wantHeaders: ['Capture-ID'],
  });

  return { captureId: response.headers['capture-id'] ?? null };
}

export async function refundOrderAmount(
  orderId: string,
  amountCents: number,
  options: { description?: string; idempotencyKey: string },
): Promise<{ refundId: string | null }> {
  const response = await klarnaRequest<void>(`/ordermanagement/v1/orders/${orderId}/refunds`, {
    method: 'POST',
    body: {
      refunded_amount: amountCents,
      ...(options.description ? { description: options.description } : {}),
    },
    idempotencyKey: options.idempotencyKey,
    wantHeaders: ['Refund-ID'],
  });

  return { refundId: response.headers['refund-id'] ?? null };
}

/** Cancels the remaining authorisation. Only valid before anything is captured. */
export function cancelOrder(orderId: string): Promise<KlarnaResponse<void>> {
  return klarnaRequest<void>(`/ordermanagement/v1/orders/${orderId}/cancel`, { method: 'POST' });
}

/**
 * Extends the authorisation by another 28 days.
 *
 * Klarna authorisations expire. A backordered item that ships on day 30 cannot
 * be captured against an expired authorisation, and the money is simply gone —
 * the nightly `klarna.reconcile` job extends anything approaching its expiry.
 */
export function extendAuthorization(orderId: string): Promise<KlarnaResponse<void>> {
  return klarnaRequest<void>(`/ordermanagement/v1/orders/${orderId}/authorization`, {
    method: 'PATCH',
  });
}

/** Frees the unused part of an authorisation after a partial capture. */
export function releaseRemainingAuthorization(orderId: string): Promise<KlarnaResponse<void>> {
  return klarnaRequest<void>(
    `/ordermanagement/v1/orders/${orderId}/release-remaining-authorization`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/**
 * Verifies an inbound Klarna push.
 *
 * Klarna does not sign its notifications — there is no `Stripe-Signature`
 * equivalent to check. The documented mechanism is an unguessable secret in the
 * notification URL, which is why `KLARNA_WEBHOOK_SECRET` is required in
 * production and compared in constant time here.
 *
 * The secret alone is not treated as proof: the caller re-reads the order from
 * Klarna's API and acts on *that*, so a leaked URL lets an attacker trigger a
 * lookup and nothing else.
 */
export function verifyPushToken(provided: string | null): boolean {
  const expected = env.KLARNA_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  return timingSafeEqual(provided, expected);
}

export interface KlarnaPushEvent {
  event_type: 'FRAUD_RISK_ACCEPTED' | 'FRAUD_RISK_REJECTED' | 'FRAUD_RISK_STOPPED' | (string & {});
  order_id: string;
}
