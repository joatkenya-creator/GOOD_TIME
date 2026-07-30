import { env, isProduction } from '@/lib/env';

/**
 * Structured logging.
 *
 * Vercel ingests stdout as JSON when a line parses as JSON, so a `console` call
 * with a serialised object is all the transport we need — a logging library here
 * would buy formatting we do not use and a dependency we would have to keep
 * current. In development the output is plain text, which is far easier to read.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVEL_ORDER[env.LOG_LEVEL];

export type LogContext = Record<string, unknown>;

function emit(level: Level, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < threshold) return;

  // The one place in the codebase allowed to touch `console` directly.
  // eslint-disable-next-line no-console
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (isProduction) {
    target(JSON.stringify({ level, message, time: new Date().toISOString(), ...context }));
    return;
  }

  target(`[${level}] ${message}`, context ?? '');
}

/** Serialises an unknown throwable into something safe to log. */
export function serializeError(error: unknown): LogContext {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, error?: unknown, context?: LogContext) =>
    emit('error', message, { ...context, ...(error ? serializeError(error) : {}) }),

  /** Returns a logger that stamps every line with the given fields. */
  child: (bindings: LogContext) => ({
    debug: (message: string, context?: LogContext) =>
      emit('debug', message, { ...bindings, ...context }),
    info: (message: string, context?: LogContext) =>
      emit('info', message, { ...bindings, ...context }),
    warn: (message: string, context?: LogContext) =>
      emit('warn', message, { ...bindings, ...context }),
    error: (message: string, error?: unknown, context?: LogContext) =>
      emit('error', message, { ...bindings, ...context, ...(error ? serializeError(error) : {}) }),
  }),
} as const;
