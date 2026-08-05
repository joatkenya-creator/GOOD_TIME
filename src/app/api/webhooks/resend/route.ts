import { NextResponse } from 'next/server';

import { withRoute } from '@/lib/api/handler';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { increment } from '@/lib/monitoring/metrics';
import { timingSafeEqual } from '@/lib/security/compare';
import { recordSoftBounce, suppress } from '@/services/email/suppression';

/**
 * `POST /api/webhooks/resend` — delivery events.
 *
 * ## Why this endpoint matters more than it looks
 *
 * Without it, bounces are invisible. The shop keeps sending to addresses that do
 * not exist, the bounce rate climbs, and the sending reputation degrades for the
 * *whole domain* — so the first symptom is usually not a marketing problem, it
 * is a customer saying they never received a password reset.
 *
 * ## Signature verification
 *
 * Resend signs with Svix: `svix-id`, `svix-timestamp` and `svix-signature`
 * headers, over `{id}.{timestamp}.{body}`, HMAC-SHA256 with the base64 portion
 * of the secret. Verified here with Web Crypto rather than the `svix` package —
 * it is twenty lines, and the package pulls in a Node-specific crypto path that
 * does not exist in the Workers runtime.
 *
 * The timestamp check is not optional. Without it a captured request can be
 * replayed forever, and a replayed `email.complained` permanently unsubscribes
 * a customer who never complained.
 */
const REPLAY_WINDOW_SECONDS = 300;

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; message?: string; subType?: string };
  };
}

async function verifySignature(
  body: string,
  headers: Headers,
  secret: string,
): Promise<'ok' | 'bad-signature' | 'stale'> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');

  if (!id || !timestamp || !signature) return 'bad-signature';

  // Replay window. A captured request must not stay valid indefinitely.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > REPLAY_WINDOW_SECONDS) return 'stale';

  // `whsec_<base64>` — the HMAC key is the decoded base64 part, not the string.
  const rawKey = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (char) => char.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );

  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));

  /*
   * The header carries a space-separated list of `v1,<signature>` — Svix sends
   * more than one during a secret rotation, so both the old and the new key
   * verify while the change propagates. Any match is a pass.
   */
  const provided = signature.split(' ').map((part) => part.split(',')[1] ?? '');

  return provided.some((candidate) => timingSafeEqual(candidate, expected))
    ? 'ok'
    : 'bad-signature';
}

export const POST = withRoute(
  async ({ request }) => {
    if (!env.RESEND_WEBHOOK_SECRET) {
      // Unconfigured means closed. An endpoint that mutates the suppression
      // list is not one to leave open while somebody remembers to set a secret.
      logger.error('resend.webhook_unconfigured', undefined);
      return NextResponse.json({ ok: false }, { status: 503 });
    }

    const body = await request.text();
    const result = await verifySignature(body, request.headers, env.RESEND_WEBHOOK_SECRET);

    if (result !== 'ok') {
      logger.warn('resend.webhook_rejected', { reason: result });
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    let event: ResendEvent;
    try {
      event = JSON.parse(body) as ResendEvent;
    } catch {
      return NextResponse.json({ received: true });
    }

    const recipients = Array.isArray(event.data?.to)
      ? event.data.to
      : event.data?.to
        ? [event.data.to]
        : [];

    increment('email.event', { type: event.type });

    for (const email of recipients) {
      switch (event.type) {
        case 'email.bounced': {
          const isHard = (event.data?.bounce?.type ?? '').toLowerCase() === 'permanent';
          const input = {
            email,
            reason: 'HARD_BOUNCE' as const,
            providerMessageId: event.data?.email_id ?? null,
            detail: event.data?.bounce?.message ?? event.data?.bounce?.subType ?? null,
          };

          // Soft bounces are counted, not acted on. A full mailbox is temporary,
          // and suppressing on the first one loses a customer over a busy inbox.
          if (isHard) await suppress(input);
          else await recordSoftBounce(input);
          break;
        }

        case 'email.complained':
          // Permanent, and never overridable by a preference screen afterwards.
          await suppress({
            email,
            reason: 'COMPLAINT',
            providerMessageId: event.data?.email_id ?? null,
            detail: 'Recipient reported the message as spam.',
          });
          break;

        case 'email.delivered':
          // Counted only. The delivery rate is the metric that shows an
          // authentication problem before customers start reporting one.
          increment('email.delivered');
          break;

        default:
          logger.debug('resend.webhook.ignored', { type: event.type });
      }
    }

    return NextResponse.json({ received: true });
  },
  // Resend is by definition cross-origin; the Svix signature replaces the
  // origin check. The rate limit is generous because a bounce storm is a real
  // burst, and tight enough that a leaked secret cannot be used to flood.
  { csrf: false, rateLimit: { bucket: 'resend-webhook', limit: 300, windowSeconds: 60 } },
);

/** Never let a caching layer sit in front of a webhook. */
export const dynamic = 'force-dynamic';
