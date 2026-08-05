import { TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/utils/cn';

/**
 * A headline figure with its comparison.
 *
 * The comparison is not decoration. A number alone ("$12,400") is trivia; the
 * same number against the previous equivalent window is information. When there
 * is no base to compare against, the card says so instead of drawing a green
 * arrow next to a made-up percentage.
 *
 * Direction is never carried by colour alone — the arrow and the sign both say
 * it, so the card still works in greyscale and for a red/green colour-blind
 * reader, who is a substantial minority of any staff room.
 */
export function StatCard({
  label,
  value,
  changePercent,
  hint,
  href,
  /** True when down is good — refund requests, failed payments. */
  invertTrend = false,
}: {
  label: string;
  value: string;
  changePercent?: number | null;
  hint?: string;
  href?: string;
  invertTrend?: boolean;
}) {
  const positive = changePercent !== null && changePercent !== undefined && changePercent >= 0;
  const good = invertTrend ? !positive : positive;
  const Arrow = positive ? TrendingUp : TrendingDown;

  const body = (
    <>
      <p className="text-body-xs font-medium tracking-wide text-foreground-subtle uppercase">
        {label}
      </p>

      <p className="text-display-xs mt-2 font-semibold text-foreground tabular-nums">{value}</p>

      <div className="text-body-xs mt-2 flex items-center gap-1.5">
        {changePercent === null || changePercent === undefined ? (
          <span className="text-foreground-subtle">No prior period to compare</span>
        ) : (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium',
                good ? 'text-success-700' : 'text-danger-700',
              )}
            >
              <Arrow className="size-3.5" aria-hidden="true" />
              {positive ? '+' : ''}
              {changePercent}%
            </span>
            {hint ? <span className="text-foreground-subtle">{hint}</span> : null}
          </>
        )}
      </div>
    </>
  );

  const className =
    'block rounded-xl border border-border bg-surface p-5 transition-colors' +
    (href ? ' hover:border-border-strong' : '');

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * Sparkline, drawn as an inline SVG.
 *
 * No chart library: this is a polyline and an area fill, and the smallest
 * charting dependency is far larger than the code it would replace. When there
 * is a real need for axes, tooltips and legends — the reports module — that is
 * the moment to reconsider, not this one.
 *
 * The series is also exposed as a table to screen readers, because a path
 * element announces nothing at all.
 */
export function Sparkline({
  points,
  label,
  formatValue,
}: {
  points: { date: Date; value: number }[];
  label: string;
  formatValue: (value: number) => string;
}) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-body-sm text-foreground-subtle">No data yet.</p>;
  }

  const width = 600;
  const height = 140;
  const max = Math.max(...points.map((point) => point.value), 1);

  const coords = points.map((point, index) => {
    const x = (index / Math.max(1, points.length - 1)) * width;
    const y = height - (point.value / max) * (height - 8) - 4;
    return { x, y };
  });

  const line = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. Peak ${formatValue(max)}.`}
      >
        <path d={area} className="fill-accent/10" />
        <path
          d={line}
          className="stroke-accent"
          strokeWidth={2}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {/*
        The same series as a table, for anyone who cannot see the path. Visually
        hidden rather than omitted: a chart with no text alternative is simply
        not there for a screen reader.
      */}
      <figcaption className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date.toISOString()}>
                <th scope="row">
                  {point.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </th>
                <td>{formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
