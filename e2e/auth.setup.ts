import { test as setup, expect } from '@playwright/test';

import { ADMIN, signIn, STORAGE_STATE } from './fixtures';

/**
 * Signs in once per run and saves the session to disk.
 *
 * One account, not three. Sessions for a super-admin and a customer were saved
 * here too and nothing consumed them — `auth.spec.ts` signs in for real because
 * sign-in is what it tests. Three parallel sign-ins also contended for the
 * database connection pool badly enough to exceed a 60-second timeout, so
 * dropping the two unused ones fixed a failure and removed dead code at once.
 *
 * ## Why this exists rather than a sign-in inside each fixture
 *
 * The fixture used to sign in fresh for every admin test. Eleven admin tests
 * plus the auth suite meant a dozen sign-ins from one IP inside a minute — and
 * the application's own rate limiter (ten attempts per five minutes, see
 * `auth.actions.ts`) correctly refused them. The suite then failed with
 * "page.waitForURL: Timeout" on tests that had nothing to do with
 * authentication, which reads as an admin bug and is not one. The limiter was
 * doing its job; the test harness was the abusive client.
 *
 * Signing in once is also the difference between paying bcrypt and a handful of
 * database round trips once (~6 seconds) and paying it a dozen times.
 *
 * ## What this deliberately does not do
 *
 * It does not forge a cookie. The session is obtained through the real form, so
 * if sign-in breaks, this fails first and loudly — which is the correct place
 * for that failure to surface. `e2e/auth.spec.ts` still exercises sign-in
 * properly, including the failure paths; those tests run without a saved
 * session precisely so they test the real thing.
 */

setup('authenticate as admin', async ({ page, baseURL }) => {
  await page
    .context()
    .addCookies([{ name: 'gt.age_ok', value: '1', domain: new URL(baseURL!).hostname, path: '/' }]);

  // Generous: bcrypt is deliberately slow and the database may be a continent
  // away. This runs once, so the cost is paid once.
  await signIn(page, ADMIN);

  // Prove the session actually grants admin access before saving it. A cookie
  // that exists but is not authorised would make every admin test fail later
  // with a confusing "heading not found".
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: STORAGE_STATE.admin });
});
