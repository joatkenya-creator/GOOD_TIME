import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/constants/routes';
import { footerNav, primaryNav } from '@/config/navigation';

/**
 * The links the site renders must point at routes the site serves.
 *
 * ## The bug this exists to prevent
 *
 * The global navigation and the homepage linked to seventeen URLs that returned
 * 404 — `/collections` and every collection, `/guides` and three articles,
 * `/brands`, plus four "material" links pointing at collections that had never
 * existed. Next prefetches every visible link, so those 404s fired on *every*
 * page view before anyone clicked anything.
 *
 * Nothing failed loudly. The pages rendered, the links looked right, and the
 * only symptom was a customer hitting a dead end and a crawler spending its
 * budget on nothing.
 *
 * These tests hold the shape of the fix. The end-to-end crawl in
 * `e2e/checkout.spec.ts` and `scripts/verify-links.mjs` catch the runtime
 * version; this catches the config-level version in milliseconds.
 */

/** Every `href` reachable from the header mega menu and the footer, flattened. */
function navHrefs(): string[] {
  const found: string[] = [];

  for (const item of primaryNav) {
    if (item.href) found.push(item.href);

    for (const column of item.columns ?? []) {
      for (const entry of column.items) found.push(entry.href);
    }
  }

  for (const group of footerNav) {
    for (const entry of group.items) found.push(entry.href);
  }

  return found.filter((href) => href.startsWith('/'));
}

/**
 * Route prefixes the application actually serves.
 *
 * Deliberately a list rather than a filesystem scan: a scan would silently
 * start passing the moment somebody adds a directory, which is the opposite of
 * what this test is for.
 */
const SERVED = [
  '/',
  '/shop',
  '/search',
  '/cart',
  '/checkout',
  '/collections',
  '/brands',
  '/guides',
  '/pages/',
  '/compare',
  '/orders/lookup',
  '/account',
  '/sign-in',
  '/register',
  '/forgot-password',
  '/wishlist/',
  '/newsletter/',
  '/order/',
];

describe('navigation links', () => {
  it('only points at routes the application serves', () => {
    const unserved = navHrefs().filter((href) => {
      const path = href.split('?')[0]!;
      return !SERVED.some((prefix) =>
        prefix.endsWith('/')
          ? path.startsWith(prefix)
          : path === prefix || path.startsWith(`${prefix}/`),
      );
    });

    expect(unserved, `navigation links to unserved routes: ${unserved.join(', ')}`).toEqual([]);
  });

  it('expresses material filters as listing queries, not as collections', () => {
    /*
     * The specific regression. "Platinum-cure silicone" is a facet of a
     * product, not a curated edit — pointing it at `/collections/silicone`
     * invented a collection that was never going to exist.
     */
    const materialLinks = navHrefs().filter((href) => href.includes('material='));

    expect(materialLinks.length).toBeGreaterThan(0);

    for (const href of materialLinks) {
      expect(href.startsWith(`${ROUTES.shop}?`), href).toBe(true);
      expect(href, 'a material link must not be a collection URL').not.toContain('/collections/');
    }
  });

  it('never links to a collection slug through the material filter', () => {
    // Belt and braces: no nav link may reference the four slugs that never
    // existed, in any form.
    const ghosts = [
      '/collections/silicone',
      '/collections/glass',
      '/collections/steel',
      '/collections/non-porous',
    ];
    const offenders = navHrefs().filter((href) => ghosts.some((ghost) => href.startsWith(ghost)));

    expect(offenders).toEqual([]);
  });
});

describe('route builders', () => {
  it('build the paths the pages are mounted at', () => {
    // A builder that disagrees with the route directory produces a link that
    // 404s while every type-check passes.
    expect(ROUTES.collections).toBe('/collections');
    expect(ROUTES.collection('quiet-hours')).toBe('/collections/quiet-hours');
    expect(ROUTES.brands).toBe('/brands');
    expect(ROUTES.brand('lumen')).toBe('/brands/lumen');
    expect(ROUTES.blog).toBe('/guides');
    expect(ROUTES.post('materials')).toBe('/guides/materials');
    expect(ROUTES.page('returns')).toBe('/pages/returns');
  });
});
