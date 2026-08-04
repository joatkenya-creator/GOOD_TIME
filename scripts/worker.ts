import 'dotenv/config';

import { runForever } from '../src/lib/jobs/worker';

/**
 * The long-running worker, for a container or a VM.
 *
 *   npm run worker
 *
 * The serverless alternative is `POST /api/cron/jobs`, called on a schedule.
 * Same handlers, same queue; only the loop differs. Run one or the other, not
 * both — they would not corrupt anything (the queue claims exactly once) but
 * paying for an idle container beside a cron that already drains it is waste.
 */
void runForever({ concurrency: 4, idleMs: 2000 });
