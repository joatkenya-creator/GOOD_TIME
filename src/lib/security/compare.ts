/**
 * Constant-time comparison.
 *
 * `===` on strings short-circuits at the first differing byte, so a candidate
 * sharing a long prefix with the secret takes measurably longer to reject than
 * one differing at byte zero. That leak is enough to recover a secret one byte
 * at a time, and it is the reason every shared-secret check in this codebase
 * routes through here: the Klarna push token, the Resend webhook signature, and
 * the cron bearer token.
 *
 * Not `node:crypto`'s `timingSafeEqual`: this has to run in the Cloudflare
 * Workers runtime as well as in Node, and Web Crypto has no equivalent.
 *
 * Lengths differing is safe to leak — the caller already knows how long the
 * secret is meant to be. The contents are not.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  // Reads the full length of both regardless of where the mismatch is.
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}
