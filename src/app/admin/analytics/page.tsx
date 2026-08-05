import type { Metadata } from 'next';

import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { Sparkline, StatCard } from '@/components/admin/stat-card';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, formatMoney } from '@/features/admin/query';
import { requireAdminPermission } from '@/server/auth/admin';
import { breakdown, funnel, lifetimeValue, trend } from '@/services/analytics/rollup';
import { cn } from '@/utils/cn';

export const metadata: Metadata = { title: 'Analytics' };

/**
 * First-party analytics.
 *
 * Reads the daily rollups rather than the raw event table: a dashboard that
 * scans ten million rows works until it does not, and this one has to stay
 * fast at a million visitors.
 *
 * Everything here is measured server-side, so it counts the third of visitors
 * who block GA4 — which in this category is not a random third but the most
 * privacy-conscious segment, and the one most worth understanding.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requireAdminPermission(PERMISSIONS.analyticsRead);

  const raw = await searchParams;
  const days = Math.min(Math.max(Number(raw.days) || 30, 7), 365);

  const [sessions, pageViews, revenue, steps, devices, sources, ltv] = await Promise.all([
    trend('sessions', days),
    trend('page_views', days),
    trend('revenue', days),
    funnel(days),
    breakdown('device', days),
    breakdown('medium', days),
    lifetimeValue(),
  ]);

  const totalSessions = sessions.reduce((sum, point) => sum + point.value, 0);
  const totalViews = pageViews.reduce((sum, point) => sum + point.value, 0);
  const totalRevenue = revenue.reduce((sum, point) => sum + point.valueCents, 0);
  const purchases = revenue.reduce((sum, point) => sum + point.value, 0);

  const hasData = totalViews > 0;

  return (
    <>
      <AdminPageHeader
        title="Analytics"
        description={`First-party, measured on the server. Last ${days} days.`}
        pathname="/admin/analytics"
        actions={[7, 30, 90].map((option) => (
          <a
            key={option}
            href={`/admin/analytics?days=${option}`}
            aria-current={option === days ? 'page' : undefined}
            className={cn(
              'rounded-lg px-2.5 py-2 text-body-sm font-medium',
              option === days
                ? 'bg-accent-soft text-accent-text'
                : 'border border-border hover:bg-surface-muted',
            )}
          >
            {option}d
          </a>
        ))}
      />

      {!hasData ? (
        <AdminCard title="No data yet">
          <p className="text-body-sm text-foreground-muted">
            Nothing has been recorded. Events are written by the storefront beacon and aggregated
            nightly by the <code className="rounded bg-surface-muted px-1">analytics.rollup</code>{' '}
            job — if traffic exists but this is empty, check that the job is running on the jobs
            screen.
          </p>
        </AdminCard>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sessions" value={totalSessions.toLocaleString()} changePercent={null} />
        <StatCard label="Page views" value={totalViews.toLocaleString()} changePercent={null} />
        <StatCard label="Purchases" value={purchases.toLocaleString()} changePercent={null} />
        <StatCard label="Revenue" value={formatMoney(totalRevenue)} changePercent={null} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <AdminCard
          title="Sessions"
          description={`Daily, last ${days} days`}
          className="lg:col-span-2"
        >
          <Sparkline
            label={`Daily sessions over the last ${days} days`}
            points={sessions.map((point) => ({ date: new Date(point.date), value: point.value }))}
            formatValue={(value) => value.toLocaleString()}
          />
        </AdminCard>

        <AdminCard title="Lifetime value" description="From orders, not events">
          <dl className="space-y-3 text-body-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Median</dt>
              <dd className="font-medium tabular-nums">{formatMoney(ltv.medianCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Average</dt>
              <dd className="font-medium tabular-nums">{formatMoney(ltv.averageCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Top 10%</dt>
              <dd className="font-medium tabular-nums">{formatMoney(ltv.topDecileCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Customers</dt>
              <dd className="font-medium tabular-nums">{ltv.customers.toLocaleString()}</dd>
            </div>
          </dl>

          <p className="text-body-xs mt-3 text-foreground-subtle">
            Median as well as average, because one wholesale-sized order drags a mean somewhere no
            real customer lives.
          </p>
        </AdminCard>
      </div>

      <AdminCard
        title="Checkout funnel"
        description="Counted in sessions, not events"
        className="mt-6"
      >
        <ol className="space-y-2">
          {steps.map((step) => {
            const width = steps[0]!.count > 0 ? (step.count / steps[0]!.count) * 100 : 0;

            return (
              <li key={step.step}>
                <div className="flex items-baseline justify-between gap-3 text-body-sm">
                  <span>{step.label}</span>
                  <span className="tabular-nums">
                    {step.count.toLocaleString()}
                    {step.conversionFromPrevious !== null ? (
                      <span
                        className={cn(
                          'text-body-xs ml-2',
                          step.conversionFromPrevious < 40
                            ? 'text-danger-700'
                            : 'text-foreground-subtle',
                        )}
                      >
                        {step.conversionFromPrevious}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(width, 0.5)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>

        <p className="text-body-xs mt-3 text-foreground-subtle">
          Someone who views four products and adds two to their cart is one session at each step.
          Counting events instead reports conversion above 100% and teaches everyone to distrust the
          dashboard.
        </p>
      </AdminCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title="Devices">
          <Breakdown rows={devices} />
        </AdminCard>

        <AdminCard title="Traffic sources">
          <Breakdown rows={sources} />
        </AdminCard>
      </div>
    </>
  );
}

function Breakdown({ rows }: { rows: { label: string; value: number; share: number }[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-body-sm text-foreground-subtle">No data yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.slice(0, 8).map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="capitalize">{row.label}</span>
            <span className="tabular-nums">
              {row.value.toLocaleString()}
              <span className="text-body-xs ml-2 text-foreground-subtle">{row.share}%</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-accent" style={{ width: `${row.share}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
