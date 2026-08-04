import 'server-only';

import { logger } from '@/lib/logger';

/**
 * Application metrics and tracing seams.
 *
 * ## Why there is no SDK here
 *
 * Sentry and OpenTelemetry are both excellent and both are deployment
 * decisions rather than code decisions. Hard-wiring either means every
 * environment carries its bundle, its config surface and its network
 * behaviour — including local development, where a crash reporter phoning home
 * is noise, and CI, where it is a flake.
 *
 * So this file defines the *seams*: `recordMetric`, `startSpan`,
 * `captureError`. They log by default. Wiring Sentry means implementing three
 * functions in one file; nothing that calls them changes. That is a smaller
 * commitment than an SDK and it keeps the call sites honest — they describe
 * what happened, not which vendor is listening.
 *
 * ## What is measured
 *
 * Counters and durations, held in memory and flushed to the log. A real
 * time-series backend is the obvious next step, and the shape below is
 * deliberately the one Prometheus and OTel both accept: a name, a value, and
 * a flat bag of low-cardinality labels.
 */

type Labels = Record<string, string | number>;

interface Counter {
  name: string;
  value: number;
  labels: Labels;
}

interface Histogram {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  labels: Labels;
}

/*
 * In-process, bounded, and reset on flush.
 *
 * A serverless instance lives for minutes, so these are a per-instance sample
 * rather than a global truth — which is exactly what a metrics backend expects
 * to receive and aggregate. Pretending otherwise would mean coordination this
 * does not need.
 */
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

const MAX_SERIES = 500;

function key(name: string, labels: Labels): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => `${label}=${value}`);

  return parts.length > 0 ? `${name}{${parts.join(',')}}` : name;
}

/**
 * Increments a counter.
 *
 * Labels must be low-cardinality — a status code, a route template, a job
 * kind. Never a product id, a user id or a raw URL: one label with a million
 * values is a million series, and that is how a metrics bill arrives.
 */
export function increment(name: string, labels: Labels = {}, by = 1): void {
  if (counters.size >= MAX_SERIES) return;

  const id = key(name, labels);
  const existing = counters.get(id);

  if (existing) existing.value += by;
  else counters.set(id, { name, value: by, labels });
}

/** Records a duration or size. */
export function observe(name: string, value: number, labels: Labels = {}): void {
  if (histograms.size >= MAX_SERIES) return;

  const id = key(name, labels);
  const existing = histograms.get(id);

  if (existing) {
    existing.count += 1;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
  } else {
    histograms.set(id, { name, count: 1, sum: value, min: value, max: value, labels });
  }
}

/**
 * Times an operation and records both its duration and its outcome.
 *
 * The failure path records too, which is the point: an operation that is fast
 * because it threw immediately looks identical to a fast success in a naive
 * timer, and the `outcome` label is what separates them.
 */
export async function timed<T>(
  name: string,
  labels: Labels,
  operation: () => Promise<T>,
): Promise<T> {
  const started = Date.now();

  try {
    const result = await operation();
    observe(name, Date.now() - started, { ...labels, outcome: 'success' });
    return result;
  } catch (error) {
    observe(name, Date.now() - started, { ...labels, outcome: 'error' });
    throw error;
  }
}

export interface MetricsSnapshot {
  counters: { name: string; value: number; labels: Labels }[];
  histograms: {
    name: string;
    count: number;
    average: number;
    min: number;
    max: number;
    labels: Labels;
  }[];
  collectedAt: string;
}

/** Reads the current values without clearing them. */
export function snapshot(): MetricsSnapshot {
  return {
    counters: [...counters.values()],
    histograms: [...histograms.values()].map((entry) => ({
      name: entry.name,
      count: entry.count,
      average: Math.round(entry.sum / entry.count),
      min: entry.min,
      max: entry.max,
      labels: entry.labels,
    })),
    collectedAt: new Date().toISOString(),
  };
}

/** Reads and clears. What a scrape endpoint or a flush job calls. */
export function flush(): MetricsSnapshot {
  const current = snapshot();
  counters.clear();
  histograms.clear();
  return current;
}

/**
 * Renders the snapshot in Prometheus text format.
 *
 * Chosen because it is the one format every backend ingests — Prometheus
 * scrapes it natively, and the OTel collector, Datadog and Grafana Agent all
 * read it. Twenty lines of string building instead of a client library.
 */
export function toPrometheus(data: MetricsSnapshot = snapshot()): string {
  const lines: string[] = [];

  const renderLabels = (labels: Labels): string => {
    const parts = Object.entries(labels).map(
      ([label, value]) => `${label}="${String(value).replace(/"/g, '\\"')}"`,
    );
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
  };

  for (const counter of data.counters) {
    lines.push(`# TYPE ${counter.name} counter`);
    lines.push(`${counter.name}${renderLabels(counter.labels)} ${counter.value}`);
  }

  for (const histogram of data.histograms) {
    lines.push(`# TYPE ${histogram.name} summary`);
    lines.push(`${histogram.name}_count${renderLabels(histogram.labels)} ${histogram.count}`);
    lines.push(`${histogram.name}_sum${renderLabels(histogram.labels)} ${histogram.average * histogram.count}`);
    lines.push(`${histogram.name}_max${renderLabels(histogram.labels)} ${histogram.max}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tracing and error capture
// ---------------------------------------------------------------------------

export interface Span {
  end(attributes?: Labels): void;
}

/**
 * Starts a span.
 *
 * The signature matches OpenTelemetry's closely enough that swapping the body
 * for a real tracer needs no call-site changes. Until then it records a
 * duration, which is most of what a span is used for anyway.
 */
export function startSpan(name: string, attributes: Labels = {}): Span {
  const started = Date.now();

  return {
    end(extra: Labels = {}) {
      observe(`span.${name}`, Date.now() - started, { ...attributes, ...extra });
    },
  };
}

/**
 * Reports an error to whatever is listening.
 *
 * One funnel, so adding Sentry later is one implementation rather than a
 * search for every `catch` in the codebase. Counts by error class as well, so
 * "errors are up" is answerable without a log search.
 */
export function captureError(error: unknown, context: Labels = {}): void {
  const name = error instanceof Error ? error.name : 'UnknownError';

  increment('errors.total', { type: name });
  logger.error('error.captured', error, context);

  // Where `Sentry.captureException(error, { extra: context })` goes.
}
