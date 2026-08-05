import 'server-only';

import { randomUUID } from 'node:crypto';

import { logger } from '@/lib/logger';
import { registerAllHandlers, tickScheduler } from '@/lib/jobs/handlers';
import { claim, claimById, reclaimStale, runJob } from '@/lib/jobs/queue';

/**
 * The worker.
 *
 * Two ways to run it, both supported deliberately:
 *
 * **Push** — `runOne` is called by the Cloudflare Queues consumer in
 * `cloudflare/worker.ts` the moment a job is enqueued. This is the normal path
 * in production: latency of a second or two, no polling, no idle cost.
 *
 * **Scheduled sweep** — `drain` claims a bounded batch. A Cloudflare Cron
 * Trigger calls `/api/cron/jobs` every minute. This is the floor that makes the
 * push path allowed to fail: anything a queue message dropped, delayed, or was
 * never published for gets picked up within the minute.
 *
 * **Long-running** — `npm run worker` loops until stopped, for a container or a
 * VM. Same code, same handlers; only the loop differs.
 *
 * None is "the" architecture. Production runs the first two together, which is
 * what makes losing the queue a latency regression rather than lost work.
 */

export interface DrainOptions {
  /** Stop after this many jobs, whatever the clock says. */
  maxJobs?: number;
  /** Stop after this long, whatever the count says. Keeps under the timeout. */
  maxMs?: number;
  /** How many jobs to run at once. */
  concurrency?: number;
  workerId?: string;
}

export interface DrainResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  reclaimed: number;
  scheduled: number;
  elapsedMs: number;
}

/**
 * Runs jobs until the batch limits are hit or the queue empties.
 *
 * The time budget is checked before each round rather than after, so a batch
 * cannot start a job it has no time to finish — a job killed by a function
 * timeout leaves a stale lock and burns an attempt for nothing.
 */
export async function drain(options: DrainOptions = {}): Promise<DrainResult> {
  registerAllHandlers();

  const maxJobs = options.maxJobs ?? 25;
  const maxMs = options.maxMs ?? 50_000;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;

  const started = Date.now();
  const result: DrainResult = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    reclaimed: 0,
    scheduled: 0,
    elapsedMs: 0,
  };

  // Recover anything a crashed worker was holding, then fire due schedules.
  // Both are cheap and both are how the queue heals itself without a human.
  result.reclaimed = await reclaimStale().catch(() => 0);

  const tick = await tickScheduler().catch((error: unknown) => {
    logger.error('scheduler.failed', error);
    return { fired: 0, skipped: 0 };
  });
  result.scheduled = tick.fired;

  while (result.claimed < maxJobs && Date.now() - started < maxMs) {
    const batchSize = Math.min(concurrency, maxJobs - result.claimed);
    const jobs = await claim(workerId, batchSize);

    if (jobs.length === 0) break;

    result.claimed += jobs.length;

    const outcomes = await Promise.all(jobs.map((job) => runJob(job)));

    for (const outcome of outcomes) {
      if (outcome === 'succeeded') result.succeeded += 1;
      else if (outcome === 'retry') result.retried += 1;
      else result.dead += 1;
    }
  }

  result.elapsedMs = Date.now() - started;

  if (result.claimed > 0) {
    logger.info('worker.drained', { workerId, ...result });
  }

  return result;
}

/**
 * Runs one job by id, for the push consumer.
 *
 * Returns `'gone'` when the row could not be claimed — already running,
 * already finished, cancelled, or scheduled for later. That is the expected
 * outcome of a duplicate delivery, not an error: Cloudflare Queues guarantees
 * at-least-once, so the second copy of a message must be a no-op rather than a
 * second execution.
 *
 * Never throws. The consumer decides whether to `ack` or `retry` from the
 * return value, and an exception escaping into the Workers runtime would retry
 * the whole batch — including the jobs in it that already succeeded.
 */
export async function runOne(
  jobId: string,
  workerId = 'queue-consumer',
): Promise<'succeeded' | 'retry' | 'dead' | 'gone'> {
  registerAllHandlers();

  try {
    const job = await claimById(jobId, workerId);
    if (!job) return 'gone';

    return await runJob(job);
  } catch (error) {
    // A failure *outside* the handler — the claim query itself, a dead
    // connection. The job row is untouched, so the sweep will find it.
    logger.error('worker.run_one_failed', error, { jobId });
    return 'retry';
  }
}

/**
 * The long-running loop, for a container.
 *
 * Polls rather than listening. `LISTEN/NOTIFY` would cut latency, but it needs
 * a dedicated connection outside the pool and a reconnect strategy, and a
 * two-second floor on a background job is not a problem anyone has.
 */
export async function runForever(options: DrainOptions & { idleMs?: number } = {}): Promise<void> {
  const idleMs = options.idleMs ?? 2000;
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;

  let stopping = false;

  // Finish the job in hand before exiting. Killing a worker mid-job is how a
  // half-applied import happens.
  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info('worker.stopping', { workerId });
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.info('worker.started', { workerId });

  while (!stopping) {
    try {
      const result = await drain({ ...options, workerId, maxMs: 30_000 });
      if (result.claimed === 0) await new Promise((resolve) => setTimeout(resolve, idleMs));
    } catch (error) {
      logger.error('worker.loop_failed', error, { workerId });
      // Back off after an unexpected failure rather than spinning on it.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  logger.info('worker.stopped', { workerId });
}
