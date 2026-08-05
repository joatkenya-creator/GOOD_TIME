'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * The first-party analytics client.
 *
 * ## What it sends, and when
 *
 * Events are queued and flushed on a timer, on page hide, and when the queue
 * fills. `sendBeacon` on hide is the important one: it survives the tab
 * closing, which is exactly when the most valuable event — the exit — happens.
 * A `fetch` there is cancelled by the browser and the event is lost.
 *
 * ## Why the visitor id lives in `localStorage`
 *
 * Not a cookie, deliberately. A cookie is sent on every request to every route
 * including images and API calls, which is bandwidth for no benefit, and it
 * would need a consent banner of its own under ePrivacy. `localStorage` is
 * read only by this script, sent only to our own endpoint, and hashed with a
 * server secret before it is stored — so the value in the database cannot be
 * traced back to the browser holding it.
 *
 * ## What it does not do
 *
 * No scroll depth, no mouse movement, no time-on-page heartbeat, no
 * fingerprinting. This shop sells intimate products; a detailed behavioural
 * profile is a liability the business should not want to hold.
 */

interface QueuedEvent {
  name: string;
  path?: string;
  productId?: string;
  variantId?: string;
  searchTerm?: string;
  valueCents?: number;
  quantity?: number;
}

const STORAGE_KEY = 'gt.visitor';
const FLUSH_MS = 5000;
const MAX_QUEUE = 20;

const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** A random per-browser value. Hashed server-side before it is stored. */
function visitorId(): string {
  try {
    let value = localStorage.getItem(STORAGE_KEY);

    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, value);
    }

    return value;
  } catch {
    // Private mode, or storage disabled. A per-page-load id still gives
    // accurate event counts; it only costs session stitching.
    return crypto.randomUUID();
  }
}

function utm(): { source?: string; medium?: string; campaign?: string } | undefined {
  if (typeof window === 'undefined') return undefined;

  const params = new URLSearchParams(window.location.search);
  const source = params.get('utm_source') ?? undefined;
  const medium = params.get('utm_medium') ?? undefined;
  const campaign = params.get('utm_campaign') ?? undefined;

  return source || medium || campaign ? { source, medium, campaign } : undefined;
}

function flush(useBeacon = false): void {
  if (queue.length === 0) return;

  const body = JSON.stringify({
    events: queue.splice(0, MAX_QUEUE),
    visitor: visitorId(),
    referrer: document.referrer || undefined,
    utm: utm(),
  });

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  try {
    if (useBeacon && navigator.sendBeacon) {
      // The only transport that survives the page being closed.
      navigator.sendBeacon(
        '/api/analytics/collect',
        new Blob([body], { type: 'application/json' }),
      );
      return;
    }

    void fetch('/api/analytics/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never surface an error to a shopper.
  }
}

/** Queues an event. Exported so any component can record one. */
export function trackEvent(event: QueuedEvent): void {
  if (typeof window === 'undefined') return;

  queue.push(event);

  if (queue.length >= MAX_QUEUE) {
    flush();
    return;
  }

  timer ??= setTimeout(() => flush(), FLUSH_MS);
}

/**
 * Records page views and installs the flush handlers.
 *
 * Mounted once in the storefront layout. The pathname effect fires on every
 * client navigation, which is what makes a single-page transition count as a
 * page view — server-side logging alone would miss all of them.
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    // Guard against double-firing in development's strict double-render, and
    // against a search-param change that is not a navigation.
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    trackEvent({ name: 'page_view', path: pathname });

    const term = searchParams.get('q');
    if (pathname === '/search' && term) {
      trackEvent({ name: 'search', path: pathname, searchTerm: term });
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    /*
     * `visibilitychange`, not `beforeunload`.
     *
     * Mobile Safari does not reliably fire `beforeunload` when an app is
     * backgrounded or a tab is swiped away — which on a mobile-majority shop
     * is most sessions. `visibilitychange` fires in both cases.
     */
    function onHide() {
      if (document.visibilityState === 'hidden') flush(true);
    }

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
  }, []);

  return null;
}
