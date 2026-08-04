import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, formatRelative } from '@/features/admin/query';
import { humaniseEnum } from '@/features/admin/status';
import { describeCron } from '@/lib/jobs/cron';
import { stats as queueStats } from '@/lib/jobs/queue';
import {
  cancelJobAction,
  requeueJobAction,
  runNowAction,
  saveScheduleAction,
} from '@/server/actions/admin/platform';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { jobKindStats, listJobs, listSchedules } from '@/services/admin/platform.service';
import { cn } from '@/utils/cn';

export const metadata: Metadata = { title: 'Background jobs' };

const STATUS_TONE = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'warning',
  DEAD: 'danger',
  CANCELLED: 'neutral',
} as const;

/**
 * The queue, its schedules, and the dead-letter list.
 *
 * The headline number is the age of the oldest waiting job, not the depth.
 * A thousand jobs draining in a minute is a busy shop; ten that have waited an
 * hour means the workers are dead — and depth alone cannot tell those apart.
 */
export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.jobsRead);
  const raw = await searchParams;
  const status = String(raw.status ?? '');

  const [stats, jobs, schedules, kinds] = await Promise.all([
    queueStats(),
    listJobs({ status: status || undefined }),
    listSchedules(),
    jobKindStats(),
  ]);

  const canManage = can(user, PERMISSIONS.jobsManage);

  const stalled = (stats.oldestQueuedSeconds ?? 0) > 300;

  return (
    <>
      <AdminPageHeader
        title="Background jobs"
        description="Imports, synchronisation, email and maintenance."
        pathname="/admin/jobs"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued" value={String(stats.queued)} changePercent={null} />
        <StatCard label="Running" value={String(stats.running)} changePercent={null} />
        <StatCard
          label="Oldest wait"
          value={
            stats.oldestQueuedSeconds === null
              ? '—'
              : stats.oldestQueuedSeconds > 90
                ? `${Math.round(stats.oldestQueuedSeconds / 60)}m`
                : `${stats.oldestQueuedSeconds}s`
          }
          hint={stalled ? 'Workers may be down' : 'Healthy'}
          changePercent={null}
          invertTrend
        />
        <StatCard
          label="Dead letter"
          value={String(stats.dead)}
          hint="Exhausted their retries"
          changePercent={null}
          invertTrend
        />
      </div>

      {stalled ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-warning-700/30 bg-warning-50 p-4 text-body-sm text-warning-700"
        >
          The oldest queued job has been waiting{' '}
          {Math.round((stats.oldestQueuedSeconds ?? 0) / 60)} minutes. Either no worker is running,
          or one is stuck — check that the cron schedule is calling{' '}
          <code className="rounded bg-surface px-1">/api/cron/jobs</code>, or that{' '}
          <code className="rounded bg-surface px-1">npm run worker</code> is alive.
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <AdminCard title="Recent jobs">
            <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1">
              {['', 'QUEUED', 'RUNNING', 'DEAD', 'SUCCEEDED'].map((option) => (
                <a
                  key={option || 'all'}
                  href={option ? `/admin/jobs?status=${option}` : '/admin/jobs'}
                  aria-current={status === option ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-body-xs font-medium',
                    status === option
                      ? 'bg-accent-soft text-accent-text'
                      : 'border border-border hover:bg-surface-muted',
                  )}
                >
                  {option ? humaniseEnum(option) : 'All'}
                </a>
              ))}
            </nav>

            {jobs.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-foreground-subtle">
                Nothing here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {jobs.map((job) => (
                  <li key={job.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-body-xs font-medium">{job.kind}</p>
                        <p className="truncate text-body-xs text-foreground-subtle">
                          {formatRelative(job.createdAt)}
                          {job.attempts > 1 ? ` · attempt ${job.attempts} of ${job.maxAttempts}` : ''}
                          {job.schedule ? ` · ${job.schedule.name}` : ''}
                        </p>
                        {job.lastError ? (
                          <p className="mt-1 truncate text-body-xs text-danger-700">
                            {job.lastError}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill
                          label={humaniseEnum(job.status)}
                          tone={STATUS_TONE[job.status] ?? 'neutral'}
                        />

                        {canManage && (job.status === 'DEAD' || job.status === 'FAILED') ? (
                          <form action={requeueJobAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-border px-2 py-1 text-body-xs hover:bg-surface-muted"
                            >
                              Retry
                            </button>
                          </form>
                        ) : null}

                        {canManage && job.status === 'QUEUED' ? (
                          <form action={cancelJobAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-border px-2 py-1 text-body-xs text-foreground-muted hover:bg-danger-50 hover:text-danger-700"
                            >
                              Cancel
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

          <AdminCard title="By kind" description="Where the work goes">
            {kinds.length === 0 ? (
              <p className="py-4 text-center text-body-sm text-foreground-subtle">
                No jobs recorded.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-body-sm">
                  <thead>
                    <tr className="border-b border-border text-body-xs tracking-wide text-foreground-subtle uppercase">
                      <th scope="col" className="py-2 pr-3">Kind</th>
                      <th scope="col" className="py-2 pr-3 text-right">Queued</th>
                      <th scope="col" className="py-2 pr-3 text-right">Succeeded</th>
                      <th scope="col" className="py-2 text-right">Dead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kinds.map((kind) => (
                      <tr key={kind.kind} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-mono text-body-xs">{kind.kind}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{kind.queued}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{kind.succeeded}</td>
                        <td
                          className={cn(
                            'py-2 text-right tabular-nums',
                            kind.dead > 0 && 'font-medium text-danger-700',
                          )}
                        >
                          {kind.dead}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        </div>

        <AdminCard title="Schedules">
          {schedules.length === 0 ? (
            <p className="text-body-sm text-foreground-subtle">
              None configured. Run <code className="rounded bg-surface-muted px-1">db:seed:phase7</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-body-sm font-medium">{schedule.name}</p>
                  <p className="text-body-xs text-foreground-subtle">{schedule.description}</p>
                  <p className="mt-0.5 text-body-xs">
                    <span className="font-mono">{schedule.cron}</span>
                    <span className="text-foreground-subtle"> — {describeCron(schedule.cron)}</span>
                  </p>
                  {schedule.lastRunAt ? (
                    <p className="text-body-xs text-foreground-subtle">
                      Last run {formatRelative(schedule.lastRunAt)}
                    </p>
                  ) : null}

                  {canManage ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <form action={saveScheduleAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={schedule.id} />
                        <label htmlFor={`cron-${schedule.id}`} className="sr-only">
                          Cron for {schedule.name}
                        </label>
                        <input
                          id={`cron-${schedule.id}`}
                          name="cron"
                          defaultValue={schedule.cron}
                          className="h-8 w-28 rounded-lg border border-border bg-surface px-2 font-mono text-body-xs"
                        />
                        <label className="flex items-center gap-1 text-body-xs">
                          <input
                            type="checkbox"
                            name="isActive"
                            defaultChecked={schedule.isActive}
                            className="size-3.5 rounded border-border-strong text-accent"
                          />
                          On
                        </label>
                        <button
                          type="submit"
                          className="h-8 rounded-lg border border-border px-2 text-body-xs hover:bg-surface-muted"
                        >
                          Save
                        </button>
                      </form>

                      <form action={runNowAction}>
                        <input type="hidden" name="kind" value={schedule.kind} />
                        <button
                          type="submit"
                          className="h-8 rounded-lg bg-accent px-2.5 text-body-xs font-medium text-white hover:bg-accent-hover"
                        >
                          Run now
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>
    </>
  );
}
