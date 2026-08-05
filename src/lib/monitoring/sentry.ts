import { env } from '@/lib/env';

/**
 * Error reporting to Sentry.
 *
 * ## Why the envelope API and not `@sentry/nextjs`
 *
 * The official SDK instruments the Node runtime — `async_hooks`, monkey-patched
 * `http`, a build-time webpack plugin. None of that exists in the Cloudflare
 * Workers runtime this deploys to, so using it means pulling in
 * `@sentry/cloudflare` as well, wiring a second init path, and carrying ~90 KB
 * into an isolate that is billed on CPU time.
 *
 * What we actually need from Sentry is: an exception with a stack trace, tags,
 * request context, and correct grouping. That is one POST to the envelope
 * endpoint, which is a documented, stable, versioned API. This file is the
 * whole client, it works identically in Node and in Workers, and it costs
 * nothing when `SENTRY_DSN` is unset.
 *
 * Swap in the SDK the day distributed tracing and session replay are worth the
 * weight — `captureException` is the only function anything calls, so it is a
 * one-file change. See docs/monitoring.md.
 *
 * ## Delivery
 *
 * Sends are fire-and-forget from the caller's perspective but tracked here, so
 * `flush()` can await them before an isolate is frozen. A Worker that returns
 * before its promises settle gets suspended mid-request, and the report is
 * simply lost — which is the failure mode that makes people think error
 * reporting "works sometimes".
 */

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

/**
 * `https://<key>@<host>/<path?>/<project_id>` — the path prefix is optional and
 * present on self-hosted installs.
 */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split('/').filter(Boolean).pop();
    if (!projectId || !url.username) return null;

    const prefix = url.pathname.split('/').filter(Boolean).slice(0, -1).join('/');
    const base = `${url.protocol}//${url.host}${prefix ? `/${prefix}` : ''}`;

    return { endpoint: `${base}/api/${projectId}/envelope/`, publicKey: url.username };
  } catch {
    return null;
  }
}

let cached: ParsedDsn | null | undefined;

function dsn(): ParsedDsn | null {
  if (cached === undefined) cached = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;
  return cached;
}

export function isSentryEnabled(): boolean {
  return dsn() !== null;
}

/** In-flight sends, so `flush` has something to await. */
const pending = new Set<Promise<unknown>>();

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface CaptureOptions {
  level?: SentryLevel;
  /** Indexed and searchable in Sentry. Low cardinality only. */
  tags?: Record<string, string | number | boolean>;
  /** Not indexed. Anything useful for debugging one occurrence. */
  extra?: Record<string, unknown>;
  /** Groups issues by the code path rather than by the message. */
  transaction?: string;
  user?: { id?: string; email?: string; ip_address?: string };
  request?: { url?: string; method?: string; headers?: Record<string, string> };
  /** Overrides Sentry's default grouping. Use when messages carry ids. */
  fingerprint?: string[];
}

interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/**
 * Parses a V8 stack into Sentry frames.
 *
 * Without frames Sentry groups by message alone, so "Order abc123 not found"
 * and "Order def456 not found" become two thousand separate issues instead of
 * one. Frames are sent oldest-first, which is the order Sentry renders bottom
 * to top.
 */
function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];

  for (const line of stack.split('\n').slice(1)) {
    // `    at fn (file:line:col)` and the bare `    at file:line:col` form.
    const match =
      /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/.exec(line) ??
      /^\s*at\s+(.+?):(\d+):(\d+)$/.exec(line);

    if (!match) continue;

    const [fn, filename, lineno, colno] =
      match.length === 5
        ? [match[1]!, match[2]!, match[3]!, match[4]!]
        : ['<anonymous>', match[1]!, match[2]!, match[3]!];

    frames.push({
      filename,
      function: fn,
      lineno: Number(lineno),
      colno: Number(colno),
      // `in_app` is what makes Sentry show our code instead of forty frames of
      // framework internals above it.
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }

  return frames.reverse();
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Strips anything that must never leave the building.
 *
 * Header allowlist rather than denylist: a denylist is one new header away from
 * shipping a session cookie to a third party, and the headers that actually help
 * debugging are a short, known list.
 */
const SAFE_HEADERS = ['user-agent', 'referer', 'accept-language', 'cf-ray', 'cf-ipcountry'];

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};

  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_HEADERS.includes(key.toLowerCase())),
  );
}

/**
 * Reports an exception.
 *
 * Never throws and never rejects: a monitoring failure must not become the
 * error the customer sees. Returns the event id so it can be shown on an error
 * page — "quote reference 4f2a…" turns an unactionable bug report into a
 * one-click lookup.
 */
export function captureException(error: unknown, options: CaptureOptions = {}): string | null {
  const target = dsn();
  if (!target) return null;

  const id = eventId();
  const thrown = error instanceof Error ? error : new Error(String(error));

  const payload = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: options.level ?? 'error',
    environment: env.SENTRY_ENVIRONMENT,
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    ...(options.transaction ? { transaction: options.transaction } : {}),
    ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
    tags: { runtime: typeof navigator === 'undefined' ? 'node' : 'workerd', ...options.tags },
    extra: options.extra ?? {},
    ...(options.user ? { user: options.user } : {}),
    ...(options.request
      ? {
          request: {
            ...(options.request.url ? { url: options.request.url } : {}),
            ...(options.request.method ? { method: options.request.method } : {}),
            headers: safeHeaders(options.request.headers),
          },
        }
      : {}),
    exception: {
      values: [
        {
          type: thrown.name,
          value: thrown.message,
          stacktrace: { frames: parseStack(thrown.stack) },
          mechanism: { type: 'generic', handled: true },
        },
      ],
    },
  };

  const envelope = [
    JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: env.SENTRY_DSN }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(payload),
  ].join('\n');

  const send = fetch(target.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=good-time/1.0`,
    },
    body: envelope,
    // A slow Sentry must not hold a request open.
    signal: AbortSignal.timeout(3_000),
  })
    // Swallowed on purpose: see the doc comment. The alternative is an
    // unhandled rejection taking down the isolate because monitoring blipped.
    .catch(() => undefined)
    .finally(() => pending.delete(send));

  pending.add(send);
  return id;
}

/**
 * Waits for in-flight reports.
 *
 * Call before an isolate can be frozen — the end of a queue consumer, the end
 * of a scheduled handler, the error path of a route. Bounded, because flushing
 * must not itself become the thing that times out.
 */
export async function flush(timeoutMs = 2_000): Promise<void> {
  if (pending.size === 0) return;

  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Test seam. */
export function __resetSentry(): void {
  cached = undefined;
  pending.clear();
}
