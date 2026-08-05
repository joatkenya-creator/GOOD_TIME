import type { Metadata } from 'next';
import Link from 'next/link';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { PERMISSIONS } from '@/constants/permissions';
import { formatRelative } from '@/features/admin/query';
import { humaniseEnum } from '@/features/admin/status';
import { rollbackImportAction, startImportAction } from '@/server/actions/admin/platform';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { importStats, listImportJobs, listTemplates } from '@/services/admin/platform.service';

export const metadata: Metadata = { title: 'Imports' };

const STATUS_TONE = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  ROLLED_BACK: 'warning',
} as const;

/**
 * Import history and the button that starts one.
 *
 * The list leads with outcome counts rather than a status word, because
 * "completed" tells an operator nothing they need — 4,812 created and 12
 * failed is a good night; 3 created and 4,821 failed is a broken mapping, and
 * both say "completed".
 */
export default async function AdminImportsPage() {
  const user = await requireAdminPermission(PERMISSIONS.importRead);

  const [jobs, templates, stats] = await Promise.all([
    listImportJobs(),
    listTemplates(),
    importStats(),
  ]);

  const canRun = can(user, PERMISSIONS.importRun);
  const canRollback = can(user, PERMISSIONS.importRollback);
  const activeTemplates = templates.filter((template) => template.isActive);

  return (
    <>
      <AdminPageHeader
        title="Imports"
        description="Supplier feeds, affiliate catalogues and file uploads."
        pathname="/admin/imports"
        actions={
          <Link
            href="/admin/imports/templates"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-body-sm font-medium hover:bg-surface-muted"
          >
            Templates
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Imports run" value={String(stats.total)} changePercent={null} />
        <StatCard label="Products created" value={String(stats.rowsCreated)} changePercent={null} />
        <StatCard label="Products updated" value={String(stats.rowsUpdated)} changePercent={null} />
        <StatCard
          label="Failed or partial"
          value={String(stats.failed)}
          changePercent={null}
          invertTrend
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <AdminCard title="History" description={`${jobs.length} most recent`}>
          {jobs.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-foreground-subtle">
              Nothing imported yet. Create a template, then run one.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/imports/${job.id}`}
                        className="block truncate text-body-sm font-medium hover:text-accent-text"
                      >
                        {job.sourceName}
                        {job.isDryRun ? (
                          <span className="text-body-xs ml-2 font-normal text-foreground-subtle">
                            dry run
                          </span>
                        ) : null}
                      </Link>
                      <p className="text-body-xs truncate text-foreground-subtle">
                        {job.template?.name ?? 'No template'} · {humaniseEnum(job.sourceType)} ·{' '}
                        {formatRelative(job.createdAt)}
                      </p>

                      {job.totalRows > 0 ? (
                        <p className="text-body-xs mt-1">
                          <span className="text-success-700">{job.processedRows} processed</span>
                          {job.failedRows > 0 ? (
                            <span className="text-danger-700"> · {job.failedRows} failed</span>
                          ) : null}
                          <span className="text-foreground-subtle"> of {job.totalRows}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill
                        label={humaniseEnum(job.status)}
                        tone={STATUS_TONE[job.status] ?? 'neutral'}
                      />

                      {canRollback &&
                      job.status === 'COMPLETED' &&
                      !job.isDryRun &&
                      !job.rolledBackAt ? (
                        <form action={rollbackImportAction}>
                          <input type="hidden" name="jobId" value={job.id} />
                          <button
                            type="submit"
                            className="text-body-xs rounded-lg border border-border px-2 py-1 text-foreground-muted hover:bg-warning-50 hover:text-warning-700"
                          >
                            Roll back
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {canRun ? (
          <AdminCard title="Run an import">
            {activeTemplates.length === 0 ? (
              <p className="text-body-sm text-foreground-muted">
                No active templates. A template maps a supplier&rsquo;s column names onto ours, and
                nothing can be imported without one.{' '}
                <Link href="/admin/imports/templates" className="text-accent-text underline">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <form action={startImportAction} className="space-y-3">
                <div>
                  <label htmlFor="templateId" className="mb-1.5 block text-body-sm font-medium">
                    Template
                  </label>
                  <select
                    id="templateId"
                    name="templateId"
                    required
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  >
                    {activeTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({humaniseEnum(template.sourceType)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sourceName" className="mb-1.5 block text-body-sm font-medium">
                    Name this run
                  </label>
                  <input
                    id="sourceName"
                    name="sourceName"
                    required
                    placeholder="August catalogue"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  />
                </div>

                <div>
                  <label htmlFor="url" className="mb-1.5 block text-body-sm font-medium">
                    Feed URL
                  </label>
                  <input
                    id="url"
                    name="url"
                    type="url"
                    placeholder="https://supplier.example/feed.csv"
                    className="text-body-xs h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono"
                  />
                  <p className="text-body-xs mt-1 text-foreground-subtle">
                    Leave blank to use the template&rsquo;s own URL. HTTPS only; private and
                    loopback addresses are refused.
                  </p>
                </div>

                <div>
                  <label htmlFor="conflictPolicy" className="mb-1.5 block text-body-sm font-medium">
                    When the feed disagrees
                  </label>
                  <select
                    id="conflictPolicy"
                    name="conflictPolicy"
                    className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                  >
                    <option value="fill_blanks">Keep our copy, fill blanks only</option>
                    <option value="overwrite">Let the feed win</option>
                    <option value="flag">Change nothing, flag it for review</option>
                  </select>
                  <p className="text-body-xs mt-1 text-foreground-subtle">
                    A supplier feed is not automatically more correct than a merchandiser&rsquo;s
                    copy.
                  </p>
                </div>

                <label className="flex items-start gap-2.5 text-body-sm">
                  <input
                    type="checkbox"
                    name="isDryRun"
                    defaultChecked
                    className="mt-0.5 size-4 rounded border-border-strong text-accent"
                  />
                  <span>
                    Dry run
                    <span className="text-body-xs block text-foreground-subtle">
                      Reports what would happen and writes nothing. Worth doing once per new feed.
                    </span>
                  </span>
                </label>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
                >
                  Queue import
                </button>

                <p className="text-body-xs text-foreground-subtle">
                  Imports run in the background. Imported products always arrive as drafts.
                </p>
              </form>
            )}
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}
