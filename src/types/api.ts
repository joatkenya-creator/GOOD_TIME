import type { ApiFailure, ApiResponse, ApiSuccess, PaginationMeta } from '@/lib/api/response';

/**
 * Shared API types for consumers — the web client today, the mobile app later.
 * Re-exported from one place so a client never imports out of `lib/`.
 */
export type { ApiResponse, ApiSuccess, ApiFailure, PaginationMeta };

/** Unwraps the payload type of an endpoint's response. */
export type ApiData<T> = T extends ApiSuccess<infer D> ? D : never;

/** A list response with its pagination envelope. */
export interface ApiList<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** Cursor-paginated response, used by storefront listings. */
export interface ApiCursorList<T> {
  items: T[];
  nextCursor: string | null;
}
