import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Single-use token helpers for email verification and password reset.
 *
 * The raw token is emailed once and never stored; only its SHA-256 hash goes in
 * the database. A leaked database dump therefore yields no usable reset links.
 *
 * SHA-256 rather than bcrypt is correct here: the token is already 256 bits of
 * entropy, so there is nothing for a slow hash to protect against.
 */

export interface IssuedToken {
  /** Send this to the user. Never persist it. */
  token: string;
  /** Store this. */
  tokenHash: string;
  expiresAt: Date;
}

export function issueToken(ttlSeconds: number): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, so token verification cannot be timed. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
