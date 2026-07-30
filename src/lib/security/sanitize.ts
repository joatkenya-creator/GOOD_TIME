/**
 * XSS containment.
 *
 * React escapes everything it renders, so the only real exposure is
 * `dangerouslySetInnerHTML` (rich product copy, CMS pages, blog content) and
 * attacker-controlled URLs. Both are handled here.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes a string for interpolation into raw HTML (transactional emails). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Escapes a value for embedding inside a `<script type="application/ld+json">`
 * block. `<` is the only character that can break out of the element.
 */
export function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Returns the URL if it is safe to put in an `href`, otherwise `null`.
 * Blocks `javascript:`, `data:` and other scheme-based injection.
 */
export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return SAFE_URL_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    // Relative paths are safe as long as they cannot become protocol-relative.
    return value.startsWith('/') && !value.startsWith('//') ? value : null;
  }
}

/**
 * Guards `?redirect=` / `callbackUrl` parameters against open redirects by
 * accepting same-site paths only.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/**
 * Collapses whitespace and neutralises control characters in free-text input.
 * Control characters become spaces rather than being deleted, so a stray newline
 * cannot silently glue two words together.
 */
export function normalizeText(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim();
}
