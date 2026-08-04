'use client';

import { useSyncExternalStore } from 'react';

import { setConsent } from '@/components/marketing/tag-manager';

/**
 * The consent banner.
 *
 * ## Why "Decline" is not a link in small grey text
 *
 * Both buttons are the same size, the same weight, and equally easy to hit.
 * A banner where accepting is a button and declining is a footnote is dark
 * patterning, it is non-compliant under GDPR (consent must be as easy to
 * refuse as to give), and in this category it is a straightforward betrayal of
 * the customer's expectation.
 *
 * ## Why it only appears when something needs it
 *
 * If no consent-requiring tag is enabled, there is nothing to consent to and
 * the banner never renders. A cookie notice on a site that sets no tracking
 * cookies trains people to dismiss notices without reading them.
 */

function readConsent(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)gt\.consent=([^;]+)/);
  return match ? (match[1] ?? null) : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('gt:consent', onChange);
  return () => window.removeEventListener('gt:consent', onChange);
}

export function ConsentBanner({ needed }: { needed: boolean }) {
  // Server snapshot is null, so the banner never renders during SSR — it would
  // otherwise flash for visitors who decided months ago.
  const consent = useSyncExternalStore(subscribe, readConsent, () => 'granted');

  if (!needed || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-heading"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4 shadow-lg sm:p-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="consent-heading" className="text-body-sm font-semibold">
            Analytics and advertising
          </h2>
          <p className="mt-0.5 text-body-sm text-foreground-muted">
            We would like to use third-party analytics and advertising tools. They can see which
            products you view. Declining costs you nothing — the shop works exactly the same.
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConsent(false)}
            className="flex-1 rounded-lg border border-border-strong px-4 py-2.5 text-body-sm font-medium hover:bg-surface-muted sm:flex-none"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => setConsent(true)}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
