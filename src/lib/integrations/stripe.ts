import 'server-only';

import Stripe from 'stripe';

import { errors } from '@/lib/api/errors';
import { env, integrations } from '@/lib/env';

/**
 * Stripe client — configuration only in phase 1.
 *
 * Lazily constructed so the app boots without Stripe credentials. Call sites that
 * genuinely need Stripe get a clear 503 instead of a crash at import time.
 *
 * The provider abstraction lives in `src/features/checkout/payment-provider.ts`;
 * this module is deliberately Stripe-specific and knows nothing about orders.
 */
let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!integrations.stripe) throw errors.integrationUnavailable('Stripe');

  client ??= new Stripe(env.STRIPE_SECRET_KEY!, {
    // Pin the API version: Stripe ships breaking changes behind it.
    apiVersion: '2026-06-24.dahlia',
    typescript: true,
    appInfo: { name: 'GOOD TIME', version: '0.1.0' },
    maxNetworkRetries: 2,
  });

  return client;
}

/**
 * Verifies a webhook signature and returns the parsed event.
 *
 * Never trust a webhook body without this — anyone can POST to the endpoint.
 */
export function verifyStripeWebhook(payload: string, signature: string | null): Stripe.Event {
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    throw errors.badRequest('Missing Stripe signature.');
  }

  return stripe().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
}
