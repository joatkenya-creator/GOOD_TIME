import { siteConfig } from '@/config/site';
import { type BreadcrumbEntry } from '@/lib/seo/json-ld';

/**
 * Breadcrumb generation.
 *
 * One trail feeds both the visible `<Breadcrumbs>` component and the JSON-LD
 * `BreadcrumbList`, so the two can never disagree — a common cause of Search
 * Console warnings.
 */

const HOME_CRUMB: BreadcrumbEntry = { name: 'Home', path: '/' };

/** Derives a trail from a URL path, title-casing each segment. */
export function breadcrumbsFromPath(path: string): BreadcrumbEntry[] {
  const segments = path.split('/').filter(Boolean);

  return [
    HOME_CRUMB,
    ...segments.map((segment, index) => ({
      name: humanize(segment),
      path: `/${segments.slice(0, index + 1).join('/')}`,
    })),
  ];
}

/**
 * Builds a trail from an explicit list — used where the visible label differs
 * from the slug (a product's name rather than `silk-mist-100ml`).
 */
export function breadcrumbs(...entries: BreadcrumbEntry[]): BreadcrumbEntry[] {
  return [HOME_CRUMB, ...entries];
}

/**
 * Expands a category's materialised `path` column into a trail.
 * `/wellness/massage` becomes Home > Wellness > Massage.
 */
export function breadcrumbsFromCategoryPath(
  categoryPath: string,
  names: ReadonlyMap<string, string>,
): BreadcrumbEntry[] {
  const segments = categoryPath.split('/').filter(Boolean);

  return [
    HOME_CRUMB,
    { name: 'Shop', path: '/shop' },
    ...segments.map((segment, index) => {
      const path = `/shop/${segments.slice(0, index + 1).join('/')}`;
      return { name: names.get(segment) ?? humanize(segment), path };
    }),
  ];
}

/** Plain-text trail for the `<title>` fallback and email subject lines. */
export function breadcrumbTitle(trail: BreadcrumbEntry[]): string {
  return trail
    .slice(1)
    .map((entry) => entry.name)
    .concat(siteConfig.name)
    .join(' | ');
}

function humanize(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
