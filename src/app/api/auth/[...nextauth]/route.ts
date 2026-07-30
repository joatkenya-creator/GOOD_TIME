import { handlers } from '@/lib/auth';

/**
 * Auth.js catch-all: sign-in, sign-out, OAuth callbacks, CSRF token, session.
 *
 * Not wrapped in `withRoute` — Auth.js brings its own CSRF protection and error
 * handling, and interposing ours would break the callback contract.
 */
export const { GET, POST } = handlers;
