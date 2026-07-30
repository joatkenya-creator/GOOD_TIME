import { siteConfig } from '@/config/site';

/**
 * URL construction for metadata. Every canonical, Open Graph and sitemap URL in
 * the app funnels through here so trailing slashes and the origin stay consistent.
 */
export function absoluteUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, siteConfig.url).toString();
}

/**
 * Canonical URL for a path.
 *
 * Query strings are dropped by default: `?page=2&sort=price` variants of a
 * listing must not compete with the base URL in the index. Pass the parameters
 * that genuinely change the content (pagination) to keep them.
 */
export function canonicalUrl(path: string, keepParams?: Record<string, string | number>): string {
  const url = new URL(path.split('?')[0] ?? '/', siteConfig.url);
  for (const [key, value] of Object.entries(keepParams ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** `rel=prev`/`rel=next` pair for a paginated listing. */
export function paginationLinks(
  path: string,
  page: number,
  totalPages: number,
): { previous?: string; next?: string } {
  return {
    ...(page > 1 ? { previous: canonicalUrl(path, page - 1 > 1 ? { page: page - 1 } : {}) } : {}),
    ...(page < totalPages ? { next: canonicalUrl(path, { page: page + 1 }) } : {}),
  };
}
