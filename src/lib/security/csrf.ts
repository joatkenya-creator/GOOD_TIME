import { siteConfig } from '@/config/site';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence.
 *
 * Layer 1 (this module): strict origin checking on every state-changing request.
 * Combined with `SameSite=Lax` session cookies — set by Auth.js and by our own
 * cart cookie — this covers the classic cross-site form-post attack without the
 * bookkeeping of a synchroniser token.
 *
 * Layer 2: Server Actions ship with Next's own origin check; nothing extra needed.
 *
 * A double-submit token is only required if we ever need `SameSite=None` cookies
 * (embedded checkout in a third-party iframe). Left unimplemented on purpose.
 */
export function isSameOrigin(request: Request): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;

  const origin = request.headers.get('origin');
  // Same-origin fetches from older browsers omit Origin; fall back to Referer.
  const source = origin ?? request.headers.get('referer');
  if (!source) return false;

  const allowed = new Set<string>([siteConfig.url, new URL(request.url).origin]);

  try {
    return allowed.has(new URL(source).origin);
  } catch {
    return false;
  }
}
