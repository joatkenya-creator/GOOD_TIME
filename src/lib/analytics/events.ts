/**
 * Analytics event contract.
 *
 * GA4's ecommerce reports only work if the event names and parameter shapes match
 * its schema exactly. Typing them here means a typo is a build error rather than
 * a silently empty funnel report discovered a month later.
 *
 * Phase 1 defines the contract; the emitters are wired when the pages exist.
 */

export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_category?: string;
  item_variant?: string;
  price: number; // major units — GA4 expects dollars, not cents
  quantity: number;
}

export type AnalyticsEvent =
  | { name: 'view_item_list'; params: { item_list_name: string; items: AnalyticsItem[] } }
  | { name: 'view_item'; params: { currency: string; value: number; items: AnalyticsItem[] } }
  | { name: 'add_to_cart'; params: { currency: string; value: number; items: AnalyticsItem[] } }
  | {
      name: 'remove_from_cart';
      params: { currency: string; value: number; items: AnalyticsItem[] };
    }
  | { name: 'view_cart'; params: { currency: string; value: number; items: AnalyticsItem[] } }
  | { name: 'begin_checkout'; params: { currency: string; value: number; items: AnalyticsItem[] } }
  | {
      name: 'purchase';
      params: {
        transaction_id: string;
        currency: string;
        value: number;
        tax: number;
        shipping: number;
        coupon?: string;
        items: AnalyticsItem[];
      };
    }
  | { name: 'search'; params: { search_term: string } }
  | { name: 'sign_up'; params: { method: string } }
  | { name: 'login'; params: { method: string } };

declare global {
  interface Window {
    gtag?: (command: 'event', name: string, params?: Record<string, unknown>) => void;
  }
}

/** Fire-and-forget. A missing gtag (ad blocker, no ID configured) is not an error. */
export function track(event: AnalyticsEvent): void {
  if (typeof window === 'undefined') return;
  window.gtag?.('event', event.name, event.params);
}

/** Cents to the major-unit number GA4 expects. */
export function toAnalyticsValue(cents: number): number {
  return Number((cents / 100).toFixed(2));
}
