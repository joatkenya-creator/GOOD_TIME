/**
 * Application error taxonomy.
 *
 * Route handlers and services throw these; `withRoute` maps them to a status code
 * and a stable machine-readable `code`. Anything that is not an `AppError` is a
 * bug, and is reported as a 500 with the details logged but not returned.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYMENT_REQUIRED'
  | 'INTEGRATION_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  INTEGRATION_UNAVAILABLE: 503,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(code: ErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = fieldErrors;
  }
}

export const errors = {
  badRequest: (message = 'Malformed request.') => new AppError('BAD_REQUEST', message),
  validation: (fieldErrors: Record<string, string[]>, message = 'Validation failed.') =>
    new AppError('VALIDATION_ERROR', message, fieldErrors),
  unauthenticated: (message = 'Sign in to continue.') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have access to this resource.') =>
    new AppError('FORBIDDEN', message),
  notFound: (resource = 'Resource') => new AppError('NOT_FOUND', `${resource} not found.`),
  conflict: (message: string) => new AppError('CONFLICT', message),
  rateLimited: (message = 'Too many requests. Try again shortly.') =>
    new AppError('RATE_LIMITED', message),
  integrationUnavailable: (name: string) =>
    new AppError('INTEGRATION_UNAVAILABLE', `${name} is not configured.`),
  /** Endpoint contract is defined but the implementation lands in a later phase. */
  notImplemented: (what = 'This endpoint') =>
    new AppError('NOT_IMPLEMENTED', `${what} is not available yet.`),
  internal: (message = 'Something went wrong.') => new AppError('INTERNAL_ERROR', message),
} as const;

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
