import { NextResponse } from 'next/server';

import { type ErrorCode } from '@/lib/api/errors';

/**
 * One response envelope for the whole API, so the future mobile client can write
 * a single deserialiser instead of one per endpoint.
 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

interface JsonOptions {
  status?: number;
  headers?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export function jsonOk<T>(data: T, options: JsonOptions = {}): NextResponse<ApiSuccess<T>> {
  const body: ApiSuccess<T> = options.meta
    ? { ok: true, data, meta: options.meta }
    : { ok: true, data };
  return NextResponse.json(body, { status: options.status ?? 200, headers: options.headers });
}

export function jsonPaginated<T>(
  items: T[],
  pagination: PaginationMeta,
  options: JsonOptions = {},
): NextResponse<ApiSuccess<T[]>> {
  return jsonOk(items, { ...options, meta: { ...options.meta, pagination } });
}

export function jsonError(
  code: ErrorCode,
  message: string,
  options: JsonOptions & { fieldErrors?: Record<string, string[]> } = {},
): NextResponse<ApiFailure> {
  const body: ApiFailure = {
    ok: false,
    error: options.fieldErrors
      ? { code, message, fieldErrors: options.fieldErrors }
      : { code, message },
  };
  return NextResponse.json(body, { status: options.status ?? 400, headers: options.headers });
}

export function noContent(headers?: Record<string, string>): NextResponse {
  return new NextResponse(null, { status: 204, headers });
}
