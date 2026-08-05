import 'server-only';

import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Cloudflare Turnstile verification.
 *
 * ## Where this belongs, and where it does not
 *
 * On the endpoints where an abusive request is cheap to send and expensive to
 * absorb: registration, password reset, the newsletter signup, the contact
 * form, guest order lookup. Not on checkout — a customer with a full basket who
 * gets a challenge is a lost sale, and Klarna is already doing far more
 * sophisticated fraud scoring on that request than a bot check ever would.
 *
 * ## It is one layer of three
 *
 * Cloudflare's WAF and bot management stop the volumetric attacks before a
 * request ever reaches the Worker. Rate limiting stops one client hammering one
 * endpoint. Turnstile stops the scripted-but-slow abuse that neither catches:
 * one signup per minute from a residential proxy pool, all day.
 *
 * ## Failure mode
 *
 * Unconfigured means "no check". That is a deliberate default so a fresh clone
 * runs, and `productionReadiness()` is what makes it visible before launch
 * rather than after. A *configured* Turnstile that cannot reach Cloudflare
 * fails closed, because at that point the endpoint is known to need protection
 * and letting everything through is the worse guess.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  /** Present when Cloudflare rejected it. Useful in logs, never shown to users. */
  errorCodes?: string[];
}

/**
 * Verifies a Turnstile token.
 *
 * The token is single-use and expires after five minutes — a replayed token is
 * rejected by Cloudflare, which is what makes this worth anything at all.
 *
 * `remoteIp` should be `CF-Connecting-IP`. Passing it lets Cloudflare correlate
 * the challenge with the address that solved it, so a token solved on one
 * machine and replayed from another is caught.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!integrations.turnstile) {
    // Not configured. See the header — this is the development default, and
    // `productionReadiness()` is the gate that stops it shipping.
    return { success: true };
  }

  if (!token) return { success: false, errorCodes: ['missing-input-response'] };

  try {
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET_KEY!);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      // Well inside any request budget. A challenge check that takes longer
      // than this has already cost more than the abuse it prevents.
      signal: AbortSignal.timeout(5_000),
    });

    const result = (await response.json()) as {
      success: boolean;
      'error-codes'?: string[];
    };

    if (!result.success) {
      logger.warn('turnstile.rejected', { errorCodes: result['error-codes'] });
      return { success: false, errorCodes: result['error-codes'] ?? [] };
    }

    return { success: true };
  } catch (error) {
    /*
     * Fail closed.
     *
     * Turnstile is only configured on endpoints that were judged to need it. If
     * the check cannot run, the safe assumption is that the request is the one
     * it was meant to stop — the opposite choice turns a Cloudflare blip into
     * an open registration endpoint.
     */
    logger.error('turnstile.verify_failed', error);
    return { success: false, errorCodes: ['internal-error'] };
  }
}
