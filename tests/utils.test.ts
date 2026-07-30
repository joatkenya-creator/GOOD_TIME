import { describe, expect, it } from 'vitest';

import { buildPaginationMeta, toCursorPage, toSkipTake } from '@/lib/api/pagination';
import { breadcrumbsFromPath } from '@/lib/seo/breadcrumbs';
import { canonicalUrl } from '@/lib/seo/url';
import { formatPrice, formatPriceRange } from '@/utils/format';
import { slugify, uniqueSlug } from '@/utils/slug';

describe('formatPrice', () => {
  it('treats the input as cents', () => {
    expect(formatPrice(1999)).toBe('$19.99');
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatPrice(100_000)).toBe('$1,000.00');
  });

  it('collapses a range when both ends match', () => {
    expect(formatPriceRange(1999, 1999)).toBe('$19.99');
    expect(formatPriceRange(1999, 4999)).toContain('$49.99');
  });
});

describe('slugify', () => {
  it('folds accents and strips punctuation', () => {
    expect(slugify('Crème Brûlée Massage Oil!')).toBe('creme-brulee-massage-oil');
  });

  it('never leaves leading or trailing dashes', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  it('suffixes until unique', () => {
    const taken = new Set(['silk-mist', 'silk-mist-2']);
    expect(uniqueSlug('Silk Mist', taken)).toBe('silk-mist-3');
  });
});

describe('pagination', () => {
  it('converts a page to skip/take', () => {
    expect(toSkipTake({ page: 3, pageSize: 24 })).toEqual({ skip: 48, take: 24 });
  });

  it('reports the boundaries correctly', () => {
    const meta = buildPaginationMeta({ page: 1, pageSize: 10 }, 25);
    expect(meta.totalPages).toBe(3);
    expect(meta.hasPrevious).toBe(false);
    expect(meta.hasNext).toBe(true);
  });

  it('always reports at least one page, even when empty', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 10 }, 0).totalPages).toBe(1);
  });

  it('derives a cursor only when there is another page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(toCursorPage(rows, 2)).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
    expect(toCursorPage(rows, 3).nextCursor).toBeNull();
  });
});

describe('seo helpers', () => {
  it('drops query strings from canonical URLs', () => {
    expect(canonicalUrl('/shop?sort=price_asc')).toBe('https://example.test/shop');
  });

  it('keeps parameters that genuinely change the content', () => {
    expect(canonicalUrl('/shop', { page: 2 })).toBe('https://example.test/shop?page=2');
  });

  it('builds a trail that always starts at home', () => {
    const trail = breadcrumbsFromPath('/shop/massage-oils');
    expect(trail.map((entry) => entry.name)).toEqual(['Home', 'Shop', 'Massage Oils']);
    expect(trail.at(-1)?.path).toBe('/shop/massage-oils');
  });
});
