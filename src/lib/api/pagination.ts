import { z } from 'zod';

import { PAGINATION } from '@/constants';
import { type PaginationMeta } from '@/lib/api/response';

/**
 * Offset pagination for admin tables and short listings.
 *
 * Deep offsets are slow at 100k+ rows — `OFFSET 90000` still scans 90k rows — so
 * infinite-scroll storefront listings use the cursor helpers below instead.
 */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxPageSize)
    .default(PAGINATION.defaultPageSize),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function toSkipTake(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function buildPaginationMeta(query: PageQuery, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
    hasNext: query.page < totalPages,
    hasPrevious: query.page > 1,
  };
}

/** Keyset pagination. Constant-time regardless of how deep the client scrolls. */
export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxPageSize)
    .default(PAGINATION.defaultPageSize),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Splits an over-fetched result set (`limit + 1` rows) into a page plus the
 * cursor for the next one.
 */
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
