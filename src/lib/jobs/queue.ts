import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { JobStatus } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The background job queue.
 *
 * ## Why Postgres and not Redis
 *
 * The only genuinely hard part of a queue is claiming a job exactly once when
 * several workers race for it. Postgres solves that in one statement —
 * `SELECT … FOR UPDATE SKIP LOCKED` — and the database is already in the stack,
 * already backed up, already monitored, and already transactional with the
 * data the jobs are about. Enqueuing a reindex in the same transaction as the
 * product write is impossible with an external broker and free here.
 *
 * A dedicated broker earns its operational cost somewhere north of a few
 * thousand jobs per second. A hundred thousand products re-priced nightly is
 * roughly one job per second. The adapter boundary is `enqueue`/`claim`, so
 * the day the numbers change, that is where SQS or BullMQ slots in without
 * touching a single handler.
 *
 * ## The failure model
 *
 * Retries are exponential with jitter. A job that exhausts `maxAttempts`
 * becomes `DEAD` rather than being deleted — the dead-letter queue is a status,
 * not a second table, because the thing an operator wants is "show me what
 * failed and let me requeue it", and that is one filter away here.
 *
 * A worker that crashes mid-job leaves a stale lock. `reclaimStale` finds those
 * by age and puts them back. Nothing is lost; at worst something runs twice,
 * which is why handlers are expected to be idempotent.
 */

/** Handlers register here; the worker looks them up by kind. */
export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<unknown>;

export interface JobContext {
  jobId: string;
  attempt: number;
  /** Report progress so a long import shows movement in the admin. */
  progress: (processed: number, total?: number) => Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function registerHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()].sort();
}

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  /** Lower runs first. */
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Collapses duplicates. Two "reindex product X" requests within the same
   * window become one job — which matters when a bulk edit touches four
   * hundred products and each one wants its search document rebuilt.
   */
  dedupeKey?: string;
  scheduleId?: string;
}

/**
 * Adds a job.
 *
 * Accepts an optional transaction client so a job can be enqueued atomically
 * with the write that caused it: either the product saved and its reindex is
 * queued, or neither happened. That guarantee is the main reason this queue
 * lives in the database.
 */
export async function enqueue(
  input: EnqueueInput,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ id: string; deduped: boolean }> {
  const data = {
    kind: input.kind,
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    priority: input.priority ?? 100,
    runAt: input.runAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
    scheduleId: input.scheduleId ?? null,
  };

  if (!input.dedupeKey) {
    const created = await tx.backgroundJob.create({ data, select: { id: true } });
    return { id: created.id, deduped: false };
  }

  /*
   * Upsert on the dedupe key, but only revive a job that has already finished.
   *
   * A queued or running job with the same key is the work already happening —
   * touching it would either duplicate it or reset a running job's attempt
   * count. The update below is a no-op in that case.
   */
  const existing = await tx.backgroundJob.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true, status: true },
  });

  if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) {
    return { id: existing.id, deduped: true };
  }

  if (existing) {
    await tx.backgroundJob.update({
      where: { id: existing.id },
      data: {
        ...data,
        status: 'QUEUED',
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    return { id: existing.id, deduped: false };
  }

  const created = await tx.backgroundJob.create({ data, select: { id: true } });
  return { id: created.id, deduped: false };
}

/** Enqueue many at once — used by bulk operations and the scheduler. */
export async function enqueueMany(inputs: EnqueueInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const result = await prisma.backgroundJob.createMany({
    data: inputs.map((input) => ({
      kind: input.kind,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      priority: input.priority ?? 100,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      dedupeKey: input.dedupeKey ?? null,
    })),
    // A duplicate key means the work is already queued; that is success.
    skipDuplicates: true,
  });

  return result.count;
}

interface ClaimedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Claims up to `limit` jobs for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole trick: concurrent workers each take a
 * different row instead of blocking on the same one. Without `SKIP LOCKED`
 * this degrades into a queue of workers waiting for a queue.
 */
export async function claim(workerId: string, limit = 1): Promise<ClaimedJob[]> {
  const now = new Date();

  const rows = await prisma.$queryRaw<
    { id: string; kind: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number }[]
  >`
    UPDATE "background_jobs" AS j
    SET "status"    = 'RUNNING',
        "lockedAt"  = ${now},
        "lockedBy"  = ${workerId},
        "startedAt" = COALESCE(j."startedAt", ${now}),
        "attempts"  = j."attempts" + 1,
        "updatedAt" = ${now}
    WHERE j."id" IN (
      SELECT c."id"
      FROM "background_jobs" AS c
      WHERE c."status" = 'QUEUED' AND c."runAt" <= ${now}
      ORDER BY c."priority" ASC, c."runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j."id", j."kind", j."payload", j."attempts", j."maxAttempts"
  `;

  return rows;
}

/** Marks a job done. */
export async function succeed(jobId: string, result?: unknown): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      result: (result ?? null) as Prisma.InputJsonValue,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/**
 * Records a failure and decides whether to retry.
 *
 * Backoff is exponential with jitter. The jitter is not decoration: a supplier
 * API that 500s takes every job with it, and without jitter all of them retry
 * in the same second and knock it over again the moment it recovers.
 */
export async function fail(jobId: string, error: unknown): Promise<'retry' | 'dead'> {
  const job = await prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });

  if (!job) return 'dead';

  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: 'DEAD',
        lastError: message.slice(0, 4000),
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    logger.error('job.dead', error, { jobId, attempts: job.attempts });
    return 'dead';
  }

  const backoffSeconds = Math.min(2 ** job.attempts * 5, 3600);
  const jitter = Math.floor(backoffSeconds * 0.25 * Math.random());

  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'QUEUED',
      lastError: message.slice(0, 4000),
      runAt: new Date(Date.now() + (backoffSeconds + jitter) * 1000),
      lockedAt: null,
      lockedBy: null,
    },
  });

  logger.warn('job.retry', { jobId, attempt: job.attempts, inSeconds: backoffSeconds + jitter });
  return 'retry';
}

/**
 * Returns jobs abandoned by a crashed worker.
 *
 * A lock older than the timeout means the worker holding it is gone: processes
 * are killed, containers are rescheduled, laptops are closed. Without this the
 * job stays `RUNNING` forever and nothing tells anyone.
 */
export async function reclaimStale(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const result = await prisma.backgroundJob.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });

  if (result.count > 0) logger.warn('job.reclaimed', { count: result.count });
  return result.count;
}

/** Runs one claimed job through its handler. */
export async function runJob(job: ClaimedJob): Promise<'succeeded' | 'retry' | 'dead'> {
  const handler = handlers.get(job.kind);

  if (!handler) {
    // An unknown kind is a deploy problem, not a transient one. Retrying it
    // until it dies wastes an hour discovering that.
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: 'DEAD',
        lastError: `No handler registered for "${job.kind}"`,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    logger.error('job.no_handler', new Error(job.kind), { jobId: job.id });
    return 'dead';
  }

  const context: JobContext = {
    jobId: job.id,
    attempt: job.attempts,
    progress: async (processed, total) => {
      await prisma.backgroundJob
        .update({
          where: { id: job.id },
          data: {
            result: { processed, total: total ?? null } as Prisma.InputJsonValue,
            // Touching the lock proves the worker is alive, so a long job is
            // not mistaken for an abandoned one.
            lockedAt: new Date(),
          },
        })
        .catch(() => undefined);
    },
  };

  try {
    const result = await handler(job.payload, context);
    await succeed(job.id, result);
    return 'succeeded';
  } catch (error) {
    return (await fail(job.id, error)) === 'dead' ? 'dead' : 'retry';
  }
}

/** Requeues a dead job — the "try that again" button in the admin. */
export async function requeue(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'QUEUED',
      attempts: 0,
      runAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      finishedAt: null,
    },
  });
}

export async function cancel(jobId: string): Promise<void> {
  await prisma.backgroundJob.updateMany({
    // Only a job that has not started. Cancelling a running job would leave
    // its side effects half-applied with nothing recording that.
    where: { id: jobId, status: 'QUEUED' },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
}

export interface QueueStats {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
  /** Age of the oldest waiting job, in seconds. The number that matters. */
  oldestQueuedSeconds: number | null;
}

/**
 * Queue health.
 *
 * `oldestQueuedSeconds` is the one to alert on. Depth alone says nothing — a
 * thousand jobs that drain in a minute is fine, ten that have been waiting an
 * hour means the workers are dead.
 */
export async function stats(): Promise<QueueStats> {
  const [grouped, oldest] = await Promise.all([
    prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.backgroundJob.findFirst({
      where: { status: 'QUEUED', runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
      select: { runAt: true },
    }),
  ]);

  const count = (status: JobStatus) =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  return {
    queued: count('QUEUED'),
    running: count('RUNNING'),
    succeeded: count('SUCCEEDED'),
    failed: count('FAILED'),
    dead: count('DEAD'),
    oldestQueuedSeconds: oldest
      ? Math.max(0, Math.round((Date.now() - oldest.runAt.getTime()) / 1000))
      : null,
  };
}

/**
 * Deletes old finished jobs.
 *
 * Successes are noise after a few days. Dead jobs are never pruned here — they
 * are the record of what broke, and something that failed permanently should
 * be looked at by a person rather than swept up by a cron.
 */
export async function prune(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const result = await prisma.backgroundJob.deleteMany({
    where: { status: { in: ['SUCCEEDED', 'CANCELLED'] }, finishedAt: { lt: cutoff } },
  });

  return result.count;
}
