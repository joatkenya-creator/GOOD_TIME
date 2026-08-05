import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, formatMoney } from '@/features/admin/query';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { REPORTS, type ReportKey, buildReport } from '@/services/admin/report.service';
import { cn } from '@/utils/cn';

export const metadata: Metadata = { title: 'Reports' };

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.analyticsRead);
  const raw = await searchParams;

  const requested = String(raw.report ?? 'sales');
  const key = (REPORTS.some((entry) => entry.key === requested) ? requested : 'sales') as ReportKey;
  const days = Math.min(Math.max(Number(raw.days) || 30, 7), 365);

  const report = await buildReport(key, days);
  const canExport = can(user, PERMISSIONS.reportExport);

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Computed from live data. Nothing here is a placeholder."
        pathname="/admin/reports"
        actions={
          canExport ? (
            <>
              <Link
                href={`/api/admin/reports/${key}?days=${days}&format=csv`}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
              >
                CSV
              </Link>
              <Link
                href={`/api/admin/reports/${key}?days=${days}&format=xls`}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
              >
                Excel
              </Link>
              <Link
                href={`/api/admin/reports/${key}?days=${days}&format=print`}
                target="_blank"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
              >
                PDF
              </Link>
            </>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Reports" className="flex flex-wrap gap-1">
          {REPORTS.map((entry) => (
            <Link
              key={entry.key}
              href={`/admin/reports?report=${entry.key}&days=${days}`}
              aria-current={entry.key === key ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors',
                entry.key === key
                  ? 'bg-accent-soft text-accent-text'
                  : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex gap-1">
          {[7, 30, 90, 365].map((option) => (
            <Link
              key={option}
              href={`/admin/reports?report=${key}&days=${option}`}
              aria-current={option === days ? 'page' : undefined}
              className={cn(
                'text-body-xs rounded-lg px-2.5 py-1.5 font-medium',
                option === days
                  ? // Was `bg-surface-inverse text-foreground-inverse`, which is
                    // white on white once the ink ramp inverts — 1.07:1. The
                    // report tabs above already have an active style that works
                    // in both themes; reusing it is one less thing to get wrong.
                    'bg-accent-soft text-accent-text'
                  : 'border border-border hover:bg-surface-muted',
              )}
            >
              {option}d
            </Link>
          ))}
        </div>
      </div>

      <AdminCard title={report.title} description={report.description}>
        {report.rows.length === 0 ? (
          <p className="py-10 text-center text-body-sm text-foreground-subtle">
            Nothing in this window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-body-sm">
              <thead>
                <tr className="text-body-xs border-b border-border tracking-wide text-foreground-subtle uppercase">
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn('py-2 pr-3', column.align === 'right' && 'text-right')}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr key={index} className="border-b border-border last:border-0">
                    {report.columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'py-2 pr-3',
                          column.align === 'right' && 'text-right tabular-nums',
                        )}
                      >
                        {column.money
                          ? formatMoney(Number(row[column.key] ?? 0))
                          : String(row[column.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminCard title="Traffic" className="mt-6">
        <p className="text-body-sm text-foreground-muted">
          Not available. Sessions, sources and conversion rate need an analytics pipeline, which is
          a later phase — this screen would have to invent the numbers, and a fabricated conversion
          rate is the one figure most likely to be acted on.
        </p>
      </AdminCard>
    </>
  );
}
