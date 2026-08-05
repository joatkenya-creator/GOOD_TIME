import axe from 'axe-core';

import { expect, test } from './fixtures';

/**
 * Accessibility, against the real DOM.
 *
 * axe-core catches what a unit test structurally cannot: computed contrast
 * against the actual rendered colours, ARIA that references an id which is not
 * on the page, duplicate ids produced by two components that were fine in
 * isolation. All of those are invisible in a component test and obvious to a
 * screen reader.
 *
 * ## Serious and critical only
 *
 * `minor` and `moderate` findings are largely advisory and include rules that
 * fire on patterns which are correct here. Gating the build on them trains
 * people to add exclusions, and an exclusion list is how an a11y suite stops
 * finding anything. Serious and critical are the ones that actually stop
 * someone completing a purchase.
 *
 * ## Keyboard navigation is tested separately
 *
 * axe cannot tell whether a focus trap works or whether the tab order makes
 * sense, because both require *doing* something. Those are the explicit specs
 * at the bottom of this file.
 */

/*
 * The axe runtime as a string, injected with `addScriptTag({ content })`.
 *
 * Not a file path. Resolving one needs `import.meta.url`, and Playwright loads
 * these specs through a CommonJS transform where `import.meta` is a syntax
 * error — the whole file fails to load, and the reported error names the module
 * system rather than the line responsible. `axe-core` publishes its own source
 * as a string for exactly this reason.
 */
interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

const PAGES = [
  { path: '/', name: 'home' },
  { path: '/shop', name: 'catalogue' },
  { path: '/cart', name: 'cart' },
  { path: '/search?q=silk', name: 'search results' },
  { path: '/sign-in', name: 'sign in' },
  { path: '/register', name: 'register' },
  { path: '/checkout', name: 'checkout' },
];

for (const page of PAGES) {
  test(`${page.name} has no serious or critical accessibility violations`, async ({ shopper }) => {
    await shopper.goto(page.path);
    await shopper.addScriptTag({ content: axe.source });

    const violations = (await shopper.evaluate(async () => {
      // @ts-expect-error — injected above.
      const results = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return results.violations;
    })) as AxeViolation[];

    const blocking = violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );

    const report = blocking
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
            .slice(0, 3)
            .map((node) => node.target.join(' '))
            .join('\n  ')}`,
      )
      .join('\n\n');

    expect(blocking, `${page.name}:\n${report}`).toHaveLength(0);
  });
}

test.describe('keyboard navigation', () => {
  test('a skip link is the first thing a keyboard user reaches', async ({ shopper }) => {
    await shopper.goto('/');
    await shopper.keyboard.press('Tab');

    const focused = await shopper.evaluate(() => document.activeElement?.textContent?.trim());

    // Without it, reaching the product grid means tabbing through the entire
    // mega menu on every single page.
    expect(focused?.toLowerCase()).toMatch(/skip/);
  });

  test('focus is visible wherever it lands', async ({ shopper }) => {
    await shopper.goto('/shop');

    for (let step = 0; step < 12; step += 1) {
      await shopper.keyboard.press('Tab');

      const hasVisibleFocus = await shopper.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return true;

        const style = getComputedStyle(element);
        // Any of the three counts. `outline: none` with no replacement is the
        // failure — it makes the page unusable without a mouse while looking
        // perfectly fine to whoever removed it.
        return (
          style.outlineStyle !== 'none' ||
          style.boxShadow !== 'none' ||
          Number.parseFloat(style.outlineWidth) > 0
        );
      });

      expect(hasVisibleFocus).toBe(true);
    }
  });

  test('the mobile menu traps focus and Escape closes it', async ({ shopper }) => {
    await shopper.setViewportSize({ width: 375, height: 812 });
    await shopper.goto('/');

    const toggle = shopper.getByRole('button', { name: /menu/i }).first();
    if (!(await toggle.isVisible().catch(() => false))) test.skip();

    await toggle.click();

    const dialog = shopper.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    // Escape must close it. A drawer that only closes via a small × is a trap
    // for anyone not using a mouse.
    await shopper.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // And focus must come back to what opened it, not to the top of the page.
    const focusReturned = await shopper.evaluate(
      () => document.activeElement?.getAttribute('aria-expanded') !== null,
    );
    expect(focusReturned).toBe(true);
  });
});

test.describe('semantics', () => {
  test('every page has exactly one h1', async ({ shopper }) => {
    for (const page of PAGES) {
      await shopper.goto(page.path);
      const count = await shopper.locator('h1').count();

      // Zero leaves a screen-reader user with no page title; more than one
      // makes the document outline meaningless.
      expect(count, `${page.path} has ${count} h1 elements`).toBe(1);
    }
  });

  test('every image carries an alt attribute', async ({ shopper }) => {
    await shopper.goto('/shop');

    const missing = await shopper.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((image) => !image.hasAttribute('alt'))
        .map((image) => image.getAttribute('src') ?? '(no src)'),
    );

    // `alt=""` is correct for decoration. A *missing* attribute makes a screen
    // reader read the filename aloud, which on a product image is a sentence
    // nobody wants read out.
    expect(missing).toEqual([]);
  });

  test('the document declares its language', async ({ shopper }) => {
    await shopper.goto('/');
    // Without it a screen reader guesses, and guesses wrong on product names.
    expect(await shopper.locator('html').getAttribute('lang')).toBeTruthy();
  });
});
