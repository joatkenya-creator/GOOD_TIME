import { COOKIES } from '@/constants';

/**
 * Age-gate cookie handling.
 *
 * ## What this is, and what it is not
 *
 * An age gate is a good-faith age statement, not a security control. Anyone can
 * bypass it with two clicks or a cleared cookie, and pretending otherwise leads
 * to bad engineering — such as blocking page rendering server-side, which
 * de-indexes the entire catalogue.
 *
 * So it is deliberately client-side:
 *
 *   1. **The page still renders beneath it.** Search engines receive the full
 *      HTML. A gate that server-side redirects every un-cookied request would
 *      show Googlebot nothing but the gate, and the shop would vanish from
 *      search results.
 *   2. **No `cookies()` call in a layout.** Reading a cookie server-side opts the
 *      whole route out of static rendering; the homepage would stop being
 *      CDN-cacheable. At the traffic this store is built for, that is a real cost
 *      for no real gain.
 *   3. **Not `httpOnly`.** The value carries no authority, and the inline head
 *      script must read it before first paint to avoid a flash.
 *
 * Where a genuine age *verification* obligation exists — some US states now
 * require it for adult content — it belongs at checkout against an identity
 * provider, recorded against the order. That is a later phase, and this cookie
 * is not a substitute for it.
 */

/** One year: long enough that a returning customer is never re-asked. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const AGE_COOKIE = COOKIES.ageGate;

/** Attribute the inline head script stamps on `<html>`; CSS keys off it. */
export const AGE_OK_ATTRIBUTE = 'data-age-ok';

/** Escapes the cookie name for use inside a regular expression. */
const COOKIE_PATTERN = `(?:^|;\\s*)${AGE_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=1(?:;|$)`;

/**
 * Runs in `<head>` before first paint, so neither the gate nor the content
 * flashes. Kept to one statement — it blocks rendering by design.
 *
 * Anchored on a cookie boundary rather than a substring search: `indexOf` would
 * also match a cookie named `not_gt.age_ok`, which would hide the gate from
 * someone who never confirmed.
 */
export const AGE_GATE_INLINE_SCRIPT = `try{if(new RegExp('${COOKIE_PATTERN.replace(/\\/g, '\\\\')}').test(document.cookie))document.documentElement.setAttribute('${AGE_OK_ATTRIBUTE}','1')}catch(e){}`;

/** Reads the flag from a raw cookie string. Exported for testing. */
export function hasAgeConsent(cookieString: string): boolean {
  return new RegExp(COOKIE_PATTERN).test(cookieString);
}

export function readAgeConsent(): boolean {
  if (typeof document === 'undefined') return false;
  return hasAgeConsent(document.cookie);
}

export function writeAgeConsent(): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${AGE_COOKIE}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  document.documentElement.setAttribute(AGE_OK_ATTRIBUTE, '1');
}
