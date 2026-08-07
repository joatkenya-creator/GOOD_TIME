import 'server-only';

import { logger } from '@/lib/logger';

/**
 * Cloudflare Queues as the *delivery* mechanism for the job queue.
 *
 * ## The database stays the ledger
 *
 * It would have been possible to replace `background_jobs` with Cloudflare
 * Queues outright. That would have cost, all at once: the ability to enqueue a
 * reindex in the same transaction as the product write; the admin's job screen;
 * the dead-letter list an operator can actually read and requeue from; the
 * dedupe key that collapses four hundred reindex requests into one; and the
 * retry history that answers "why did this import fail three times".
 *
 * So the split is: **Postgres owns state, Cloudflare Queues owns latency.**
 *
 *   - `enqueue()` writes the row, transactionally, exactly as before.
 *   - This module then publishes the *job id* — nothing else — to the queue.
 *   - The consumer in `cloudflare/worker.ts` claims that job and runs it.
 *
 * The message is a pointer, not a payload. If the message is lost, duplicated,
 * delivered late or delivered twice, the database is still correct: the job row
 * is claimed with `FOR UPDATE SKIP LOCKED`, so a duplicate delivery claims
 * nothing, and the cron drain sweeps up anything the queue dropped. The queue
 * is a fast path, not a source of truth — which is why losing it degrades
 * latency from seconds to a minute rather than losing work.
 *
 * ## The dead-letter queue
 *
 * Two exist, and they mean different things.
 *
 *   - Cloudflare's DLQ (`intimate-bunnie-jobs-dlq`) catches messages whose *delivery*
 *     failed repeatedly — the consumer crashed, the isolate OOMed. Those are
 *     infrastructure failures and the job row is usually still `QUEUED`.
 *   - Our `JobStatus.DEAD` catches jobs whose *work* failed repeatedly. Those
 *     are application failures with a `lastError` a human can read.
 *
 * Conflating them is how a deploy bug gets misdiagnosed as a bad import file.
 */

/** Binding names, matching `wrangler.jsonc`. */
export const QUEUE_BINDINGS = {
  jobs: 'JOB_QUEUE',
  /** Separated so a ten-thousand-row import cannot delay a password reset. */
  email: 'EMAIL_QUEUE',
} as const;

export type QueueName = keyof typeof QUEUE_BINDINGS;

export interface JobMessage {
  /** The `background_jobs` row to run. The payload lives there, not here. */
  jobId: string;
  kind: string;
  /** Set when the producer already knows the work should be delayed. */
  notBefore?: string;
}

interface CloudflareQueue {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>;
  sendBatch(
    messages: { body: unknown; delaySeconds?: number }[],
    options?: { delaySeconds?: number },
  ): Promise<void>;
}

/**
 * Resolves a queue binding, or `null` when not running on Workers.
 *
 * `getCloudflareContext` is imported dynamically because the module only
 * resolves inside the OpenNext runtime — a static import would break
 * `next dev`, `vitest` and every script under `scripts/`, none of which have a
 * Workers context. Everything degrades to the cron drain, which is exactly how
 * local development already worked.
 */
async function binding(queue: QueueName): Promise<CloudflareQueue | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const found = (context.env as unknown as Record<string, CloudflareQueue | undefined>)[
      QUEUE_BINDINGS[queue]
    ];

    return found ?? null;
  } catch {
    return null;
  }
}

/**
 * Publishes a job for immediate pickup.
 *
 * Never throws. A publish failure means the job runs on the next cron drain
 * instead of in the next second — a latency regression, not data loss, and not
 * worth failing the customer-facing write that enqueued it.
 *
 * Returns whether the message was actually published, so callers that care
 * (the admin's "run now" button) can say "queued for the next sweep" rather
 * than implying something is happening right now.
 */
export async function publish(
  message: JobMessage,
  options: { queue?: QueueName; delaySeconds?: number } = {},
): Promise<boolean> {
  const queue = await binding(options.queue ?? 'jobs');
  if (!queue) return false;

  try {
    await queue.send(message, {
      // Cloudflare caps delivery delay at 12 hours. Anything further out is
      // what `runAt` and the cron drain are for.
      ...(options.delaySeconds ? { delaySeconds: Math.min(options.delaySeconds, 43_200) } : {}),
    });
    return true;
  } catch (error) {
    logger.warn('queue.publish_failed', {
      jobId: message.jobId,
      kind: message.kind,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Publishes many at once.
 *
 * Cloudflare's batch limit is 100 messages or 256 KB per call, whichever comes
 * first. Ours are job ids, so the count is always the binding constraint.
 */
export async function publishBatch(
  messages: JobMessage[],
  options: { queue?: QueueName } = {},
): Promise<number> {
  if (messages.length === 0) return 0;

  const queue = await binding(options.queue ?? 'jobs');
  if (!queue) return 0;

  let sent = 0;

  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100);

    try {
      await queue.sendBatch(chunk.map((body) => ({ body })));
      sent += chunk.length;
    } catch (error) {
      logger.warn('queue.publish_batch_failed', {
        count: chunk.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sent;
}

/** Whether push delivery is available in this runtime. Surfaced by health checks. */
export async function isQueueAvailable(): Promise<boolean> {
  return (await binding('jobs')) !== null;
}
