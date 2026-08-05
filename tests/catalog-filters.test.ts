import { describe, expect, it } from 'vitest';

import { productFilterSchema } from '@/features/catalog/schemas';

/**
 * Listing filters parsed from the query string.
 *
 * A query string is untrusted input that anybody can type and every crawler
 * will eventually mangle. The rule this file exists to protect: an unreadable
 * *presentation* parameter falls back to its default and the page renders.
 * It does not throw, because a throw here is an unauthenticated 500 on a
 * category page — and Search Console treats a run of those as a reason to stop
 * crawling the category at all.
 *
 * This is deliberately not a licence to be lax everywhere. Anything that
 * decides what is charged, what is in stock, or who may see what is validated
 * strictly elsewhere and must keep rejecting bad input loudly.
 */

describe('productFilterSchema', () => {
  it('accepts a clean query', () => {
    const parsed = productFilterSchema.parse({ sort: 'price_asc', page: '2', view: 'list' });

    expect(parsed.sort).toBe('price_asc');
    expect(parsed.page).toBe(2);
    expect(parsed.view).toBe('list');
  });

  it('falls back rather than throwing on a wrong sort value', () => {
    /*
     * The exact bug this guards. `price-asc` (hyphen) is a plausible typo for
     * `price_asc`, and it used to fail the parse and 500 the whole page.
     */
    expect(productFilterSchema.parse({ sort: 'price-asc' }).sort).toBe('relevance');
    expect(productFilterSchema.parse({ sort: 'bogus' }).sort).toBe('relevance');
    expect(productFilterSchema.parse({ sort: '' }).sort).toBe('relevance');
  });

  it('falls back on an unusable page number', () => {
    // All of these appear in real logs: truncated share links, old bookmarks,
    // and crawlers probing for pagination.
    expect(productFilterSchema.parse({ page: '0' }).page).toBe(1);
    expect(productFilterSchema.parse({ page: '-3' }).page).toBe(1);
    expect(productFilterSchema.parse({ page: 'abc' }).page).toBe(1);
    expect(productFilterSchema.parse({ page: '' }).page).toBe(1);
  });

  it('falls back on an unusable view or boolean flag', () => {
    expect(productFilterSchema.parse({ view: 'carousel' }).view).toBe('grid');
    expect(productFilterSchema.parse({ inStockOnly: 'maybe' }).inStockOnly).toBe(false);
    expect(productFilterSchema.parse({ onSaleOnly: '2' }).onSaleOnly).toBe(false);
  });

  it('never throws on anything a URL can express', () => {
    const hostile: Record<string, string>[] = [
      { sort: '../../etc/passwd' },
      { page: '99999999999999999999' },
      { view: '<script>alert(1)</script>' },
      { inStockOnly: 'true; DROP TABLE products' },
      { sort: 'price_asc', page: 'NaN', view: '' },
    ];

    for (const query of hostile) {
      expect(() => productFilterSchema.parse(query), JSON.stringify(query)).not.toThrow();
    }
  });

  it('still applies defaults when a parameter is simply absent', () => {
    const parsed = productFilterSchema.parse({});

    expect(parsed.sort).toBe('relevance');
    expect(parsed.page).toBe(1);
    expect(parsed.view).toBe('grid');
    expect(parsed.inStockOnly).toBe(false);
  });

  it('drops an unusable optional filter instead of failing the page', () => {
    /*
     * These three each produced their own 500 on `/shop`. They are `.optional()`
     * rather than defaulted, so the fallback is "no filter" — which renders the
     * unfiltered listing, exactly what someone following a mangled link wants.
     */
    expect(productFilterSchema.parse({ q: 'x'.repeat(500) }).q).toBeUndefined();
    expect(productFilterSchema.parse({ minPriceCents: '-5' }).minPriceCents).toBeUndefined();
    expect(productFilterSchema.parse({ minRating: '99' }).minRating).toBeUndefined();
  });

  it('drops a malformed facet list rather than failing the page', () => {
    // The CSV cap is 30; a crawler expanding every combination goes past it.
    const tooMany = Array.from({ length: 60 }, (_, i) => `v${i}`).join(',');
    expect(() => productFilterSchema.parse({ color: tooMany })).not.toThrow();
  });

  it('still reads a valid optional filter', () => {
    // The fallback must not swallow good input.
    const parsed = productFilterSchema.parse({ q: 'silk', minPriceCents: '1500', minRating: '4' });

    expect(parsed.q).toBe('silk');
    expect(parsed.minPriceCents).toBe(1500);
    expect(parsed.minRating).toBe(4);
  });
});
