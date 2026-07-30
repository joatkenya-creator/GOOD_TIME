/**
 * Discriminated result for operations whose failure is an expected outcome
 * (validation, business rules) rather than an exception. Server actions return
 * this so the client never has to parse an error message to decide what to render.
 *
 * Genuine faults — a dead database, a bug — still throw.
 */
export type Result<T, E = string> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E; readonly fieldErrors?: Record<string, string[]> };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function fail<E = string>(
  error: E,
  fieldErrors?: Record<string, string[]>,
): Result<never, E> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}
