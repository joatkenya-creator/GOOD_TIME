import type { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

import { AppError, errors, isAppError } from '@/lib/api/errors';
import { jsonError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { isSameOrigin } from '@/lib/security/csrf';
import { clientIdentifier, rateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';

/**
 * Route handler middleware.
 *
 * Every API route is wrapped in this so the cross-cutting concerns — origin
 * checking, rate limiting, error shaping, logging — are declared once instead of
 * being copy-pasted (and eventually forgotten) in thirty route files.
 *
 * Usage:
 *
 *   export const GET = withRoute(async ({ request }) => {
 *     return jsonOk(await listProducts());
 *   }, { rateLimit: { limit: 120 } });
 */

export interface RouteContext<Params = Record<string, string>> {
  request: NextRequest;
  params: Params;
}

export interface RouteOptions {
  /** Per-route bucket. Omit to use the global default; `false` disables it. */
  rateLimit?: { limit?: number; windowSeconds?: number; bucket?: string } | false;
  /** Origin check on POST/PUT/PATCH/DELETE. Disable only for signed webhooks. */
  csrf?: boolean;
}

type Handler<Params> = (context: RouteContext<Params>) => Promise<NextResponse> | NextResponse;

export function withRoute<Params extends Record<string, string> = Record<string, string>>(
  handler: Handler<Params>,
  options: RouteOptions = {},
) {
  return async (
    request: NextRequest,
    segment: { params: Promise<Params> },
  ): Promise<NextResponse> => {
    const startedAt = Date.now();

    try {
      if (options.csrf !== false && !isSameOrigin(request)) {
        throw errors.forbidden('Cross-origin request rejected.');
      }

      let headers: Record<string, string> | undefined;

      if (options.rateLimit !== false) {
        const bucket = options.rateLimit?.bucket ?? new URL(request.url).pathname;
        const result = rateLimit(`${bucket}:${clientIdentifier(request)}`, {
          ...(options.rateLimit?.limit !== undefined ? { limit: options.rateLimit.limit } : {}),
          ...(options.rateLimit?.windowSeconds !== undefined
            ? { windowSeconds: options.rateLimit.windowSeconds }
            : {}),
        });

        headers = rateLimitHeaders(result);
        if (!result.success) {
          return jsonError('RATE_LIMITED', 'Too many requests. Try again shortly.', {
            status: 429,
            headers,
          });
        }
      }

      const params = (await segment?.params) ?? ({} as Params);
      const response = await handler({ request, params });

      if (headers) {
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      }

      return response;
    } catch (error) {
      return toErrorResponse(error, request, Date.now() - startedAt);
    }
  };
}

function toErrorResponse(error: unknown, request: NextRequest, durationMs: number): NextResponse {
  if (error instanceof ZodError) {
    const flattened = flattenZodError(error);
    return jsonError('VALIDATION_ERROR', 'Validation failed.', {
      status: 422,
      fieldErrors: flattened,
    });
  }

  if (isAppError(error)) {
    // 4xx are the client's problem and are not worth an error-level log line.
    if (error.status >= 500) {
      logger.error('Route handler failed', error, { path: request.nextUrl.pathname, durationMs });
    }
    return jsonError(error.code, error.message, {
      status: error.status,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    });
  }

  logger.error('Unhandled route error', error, {
    path: request.nextUrl.pathname,
    method: request.method,
    durationMs,
  });

  // Never leak an internal message or stack trace to the client.
  return jsonError('INTERNAL_ERROR', 'Something went wrong.', { status: 500 });
}

/** Parses and validates a JSON request body. Throws an `AppError` on failure. */
export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw errors.badRequest('Request body must be valid JSON.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw errors.validation(flattenZodError(parsed.error));
  return parsed.data;
}

/** Parses and validates the query string. */
export function readQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw errors.validation(flattenZodError(parsed.error));
  return parsed.data;
}

/** Zod issues -> `{ fieldName: [messages] }`, the shape React Hook Form wants. */
export function flattenZodError(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    (result[key] ??= []).push(issue.message);
  }

  return result;
}

export { AppError, errors };
