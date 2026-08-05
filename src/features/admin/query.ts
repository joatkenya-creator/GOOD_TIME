/**
 * List-screen state lives in the URL.
 *
 * Every admin list — products, orders, customers, media — needs the same five
 * things: a search term, a status filter, a sort, a page and a page size. Doing
 * that in component state would make a filtered view unlinkable and lose it on
 * every back button. In the URL it is a link someone can paste into Slack.
 *
 * These helpers exist so fifteen modules parse those parameters identically,
 * rather than each inventing its own handling of `?page=-3`.
 */
export interface ListParams {
  q: string;
  status: string;
  sort: string;
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
  /** Anything module-specific: category, tag, level, tier. */
  extra: Record<string, string>;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export function parseListParams(
  raw: RawSearchParams,
  defaults: { sort?: string; direction?: 'asc' | 'desc'; pageSize?: number } = {},
): ListParams {
  // Clamped, not trusted. `?page=0` and `?pageSize=100000` both arrive from the
  // address bar eventually, and a page size of 100,000 is a denial of service
  // with a friendly face.
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);
  const requestedSize = Number.parseInt(first(raw.pageSize), 10) || (defaults.pageSize ?? 25);
  const pageSize = Math.min(Math.max(requestedSize, 10), 100);

  const direction =
    first(raw.direction) === 'asc'
      ? 'asc'
      : first(raw.direction) === 'desc'
        ? 'desc'
        : (defaults.direction ?? 'desc');

  const known = new Set(['q', 'status', 'sort', 'direction', 'page', 'pageSize']);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (known.has(key)) continue;
    const single = first(value);
    if (single) extra[key] = single;
  }

  return {
    q: first(raw.q).slice(0, 120),
    status: first(raw.status),
    sort: first(raw.sort) || (defaults.sort ?? 'createdAt'),
    direction,
    page,
    pageSize,
    extra,
  };
}

/**
 * Builds a URL with some parameters replaced.
 *
 * Changing a filter always returns to page 1 — staying on page 7 of a result
 * set that now has two pages shows an empty table and looks like a bug.
 */
export function buildListHref(
  basePath: string,
  current: ListParams,
  changes: Partial<Omit<ListParams, 'extra'>> & { extra?: Record<string, string> } = {},
): string {
  const next = { ...current, ...changes, extra: { ...current.extra, ...(changes.extra ?? {}) } };

  const changedFilter =
    ('q' in changes && changes.q !== current.q) ||
    ('status' in changes && changes.status !== current.status) ||
    ('extra' in changes && changes.extra !== undefined);

  if (changedFilter && !('page' in changes)) next.page = 1;

  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.sort) params.set('sort', next.sort);
  if (next.direction) params.set('direction', next.direction);
  if (next.page > 1) params.set('page', String(next.page));
  if (next.pageSize !== 25) params.set('pageSize', String(next.pageSize));

  for (const [key, value] of Object.entries(next.extra)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Money, from integer cents. The admin never sees a float. */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * "3 minutes ago".
 *
 * On an activity feed the gap matters more than the timestamp: "2 minutes ago"
 * answers "is this happening now?", which is the actual question being asked.
 */
export function formatRelative(value: Date | string): string {
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
}
