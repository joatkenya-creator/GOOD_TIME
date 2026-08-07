import 'server-only';

import { Resend } from 'resend';

import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Transactional email — configuration only in phase 1.
 *
 * Sending is best-effort by design: a failed receipt must never roll back a paid
 * order. Failures are logged and surfaced in the return value; callers decide
 * whether to retry.
 */
let client: Resend | null = null;

function resend(): Resend {
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; id?: string }> {
  if (!integrations.resend) {
    // Not configured yet — log the intent so local development stays observable.
    logger.warn('Email not sent: Resend is not configured', {
      to: input.to,
      subject: input.subject,
    });
    return { ok: false };
  }

  // Falls back to EMAIL_REPLY_TO so every send lands somewhere a human reads,
  // without each caller having to remember it.
  const replyTo = input.replyTo ?? env.EMAIL_REPLY_TO;

  const { data, error } = await resend().emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    logger.error('Email delivery failed', error, { subject: input.subject });
    return { ok: false };
  }

  return { ok: true, ...(data?.id ? { id: data.id } : {}) };
}
