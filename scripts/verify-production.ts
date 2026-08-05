import 'dotenv/config';

import { productionReadiness } from '../src/lib/env';

/**
 * The pre-flight check.
 *
 * Run this against the *production* environment before a launch and after any
 * change to secrets:
 *
 *   NODE_ENV=production npm run verify:production
 *
 * ## Why this is not part of `env.ts`
 *
 * Making these variables `required` in the Zod schema would break `npm run dev`
 * on a fresh clone, which is a real cost paid by every new contributor forever.
 * Making them optional and hoping means a production deploy boots happily with
 * no payments, no rate limiting and no error reporting — and nothing says so
 * until a customer does.
 *
 * This splits the difference: the schema stays developer-friendly, and the
 * launch gate is explicit, enumerated and runnable in CI.
 *
 * ## What it deliberately does not do
 *
 * It does not call Klarna, Resend, Upstash or Sentry. A credential can be
 * present and wrong, and only a real call proves otherwise — that is
 * `verify:platform` and the go-live checklist, which need network access and a
 * real environment. This is the cheap check that runs everywhere, in a second,
 * and catches the far more common failure: a variable nobody set.
 */

const report = productionReadiness();

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const RESET = '[0m';

console.log('\nProduction readiness\n');

if (report.ready) {
  console.log(`${GREEN}  All production requirements are configured.${RESET}\n`);
  process.exit(0);
}

for (const item of report.missing) {
  console.log(`${RED}  MISSING${RESET}  ${item.key}`);
  console.log(`           ${item.why}\n`);
}

console.log(
  `${YELLOW}  ${report.missing.length} requirement${report.missing.length === 1 ? '' : 's'} unmet. See docs/environment.md.${RESET}\n`,
);

/*
 * Non-zero, so this fails a CI job rather than printing warnings into a log
 * nobody reads. A launch checklist that cannot fail a build is a document, not
 * a check.
 */
process.exit(1);
