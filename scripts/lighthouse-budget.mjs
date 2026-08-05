/**
 * Lighthouse, as a gate rather than a report.
 *
 *   npm run build && npx next start -p 3000
 *   npm run lighthouse
 *
 * ## Why a budget and not a score to admire
 *
 * A Lighthouse number in a pull-request comment gets looked at once. A
 * threshold that fails the build is the only version anyone acts on, because
 * the alternative is a slow, monotonic decline that nobody can point at a
 * commit for.
 *
 * ## Mobile, throttled, cold
 *
 * The default profile here is a mid-range phone on a slow 4G connection,
 * because that is what most customers actually have. A desktop run on a
 * developer's laptop measures the laptop.
 *
 * ## Per-metric budgets as well as category scores
 *
 * A category score is an average, and an average hides the one metric that
 * ruined the page. LCP and CLS are called out separately because they are the
 * two that show up in Search Console as a ranking factor rather than as a
 * suggestion.
 */

import { writeFileSync } from 'node:fs';

import lighthouse from 'lighthouse';
import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Category thresholds, out of 100.
 *
 * Performance sits below the other three deliberately. Third-party tags —
 * GA4, Clarity, Meta, Klarna's SDK on checkout — cost real script time that no
 * amount of application work recovers, and a threshold that cannot be met is
 * one people learn to ignore. The other three are entirely within our control,
 * so they are held at 95.
 */
const BUDGETS = {
  performance: 90,
  accessibility: 95,
  'best-practices': 95,
  seo: 95,
};

/** Core Web Vitals, in the units Lighthouse reports them. */
const METRICS = {
  'largest-contentful-paint': { max: 2500, label: 'LCP', unit: 'ms' },
  'cumulative-layout-shift': { max: 0.1, label: 'CLS', unit: '' },
  'total-blocking-time': { max: 300, label: 'TBT', unit: 'ms' },
  'speed-index': { max: 3400, label: 'Speed Index', unit: 'ms' },
};

const PAGES = [
  { path: '/', name: 'Home' },
  { path: '/shop', name: 'Category' },
  { path: '/search?q=silk', name: 'Search' },
];

async function audit(browser, url) {
  const result = await lighthouse(
    url,
    {
      port: Number(new URL(browser.wsEndpoint()).port),
      output: 'json',
      logLevel: 'error',
      // Cold every time. A warm run measures the cache, and a first-time
      // visitor is the one whose experience decides whether they stay.
      disableStorageReset: false,
    },
    {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 2.625 },
        throttling: {
          // Lighthouse's "Slow 4G" preset. Roughly a mid-range Android on a
          // train, which is a substantial share of real traffic.
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
          requestLatencyMs: 562.5,
          downloadThroughputKbps: 1474.56,
          uploadThroughputKbps: 675,
        },
      },
    },
  );

  return result.lhr;
}

async function main() {
  const browser = await chromium.launch({ args: ['--remote-debugging-port=9222'] });

  let failures = 0;
  const summary = [];

  try {
    for (const page of PAGES) {
      const url = `${BASE}${page.path}`;
      console.log(`\n${page.name} — ${url}`);

      const report = await audit(browser, url);
      const row = { page: page.name, url, categories: {}, metrics: {} };

      for (const [key, threshold] of Object.entries(BUDGETS)) {
        const score = Math.round((report.categories[key]?.score ?? 0) * 100);
        const ok = score >= threshold;

        row.categories[key] = score;
        if (!ok) failures += 1;

        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${key.padEnd(16)} ${score} (budget ${threshold})`);
      }

      for (const [key, budget] of Object.entries(METRICS)) {
        const value = report.audits[key]?.numericValue;
        if (value === undefined) continue;

        const ok = value <= budget.max;
        const shown = budget.unit === 'ms' ? Math.round(value) : value.toFixed(3);

        row.metrics[budget.label] = value;
        if (!ok) failures += 1;

        console.log(
          `  ${ok ? 'PASS' : 'FAIL'}  ${budget.label.padEnd(16)} ${shown}${budget.unit} (budget ${budget.max}${budget.unit})`,
        );
      }

      summary.push(row);
    }
  } finally {
    await browser.close();
  }

  // Written out so CI can attach it and a trend is reconstructable later. A
  // threshold tells you it broke; the history tells you when.
  writeFileSync('.lighthouse.json', JSON.stringify(summary, null, 2));

  console.log(
    failures === 0
      ? '\nPASS — every page is inside its budget.'
      : `\nFAIL — ${failures} budget${failures === 1 ? '' : 's'} exceeded. Report written to .lighthouse.json.`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
