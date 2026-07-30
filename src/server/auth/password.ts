import 'server-only';

import bcrypt from 'bcryptjs';

/**
 * Password hashing.
 *
 * Cost 12 is the current sensible default: roughly 250ms on the hardware Vercel
 * runs, which is slow enough to make offline cracking expensive and fast enough
 * that sign-in does not feel broken. Revisit it every couple of years.
 */
const COST = 12;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

/**
 * Verifies a password against a stored hash.
 *
 * Always runs the comparison, even when there is no hash to compare against, so
 * response timing cannot be used to enumerate which email addresses exist.
 */
export async function verifyPassword(plaintext: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plaintext, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plaintext, hash);
}

/** Hash of a random string, used only to burn the same CPU time as a real check. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO9GLfQlQ0mS0RCNqCbMBqYU7L2xW1CmC';
