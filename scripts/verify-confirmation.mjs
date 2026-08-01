import { chromium } from 'playwright';

/**
 * Confirmation page, printable receipt and guest order lookup.
 *
 * Takes an order number and the email it was placed with — `npm run verify:orders`
 * prints both as its last lines.
 *
 *   node scripts/verify-confirmation.mjs GT-100010 someone@example.test
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const ORDER = process.argv[2];
const EMAIL = process.argv[3];

let pass = 0, fail = 0; const fails = [];
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; fails.push(label + (detail ? ` — ${detail}` : '')); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'gt.age_ok', value: '1', url: BASE }]);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e).slice(0,140)));

console.log('\nConfirmation page');
const url = `${BASE}/order/${ORDER}?email=${encodeURIComponent(EMAIL)}`;
const res = await p.goto(url, { waitUntil: 'domcontentloaded' });
check('confirmation page returns 200', res?.status() === 200, `HTTP ${res?.status()}`);
await p.waitForTimeout(1200);

const text = ((await p.locator('main').textContent()) ?? '').replace(/\s+/g, ' ');
check('shows the order number', text.includes(ORDER));
check('shows the confirmation email address', text.includes(EMAIL));
check('shows a paid status', /paid|confirmed/i.test(text), text.slice(0, 80));
check('lists the purchased item', /qty\s*\d/i.test(text));
check('shows the order total', /\$\d+\.\d{2}/.test(text));
check('shows the shipping address', /Analytical Way/i.test(text));
check('states plain packaging', /plain/i.test(text));
check('shows the order timeline', /order history/i.test(text));
check('offers a printable receipt', await p.getByRole('link', { name: /printable receipt/i }).isVisible().catch(() => false));
check('is noindex', (await p.locator('meta[name="robots"]').getAttribute('content').catch(() => '')) ?.includes('noindex') ?? false);
await p.screenshot({ path: '.audit/confirmation.png', fullPage: true });

console.log('\nAccess control');
// What matters is that the contents are withheld. The status code is a separate,
// known issue — `notFound()` inside a route that reads searchParams still returns
// 200 in Next 16, which is why these pages are also marked noindex.
await p.goto(`${BASE}/order/${ORDER}?email=someone-else@example.test`, { waitUntil: 'domcontentloaded' });
const wrongText = (await p.locator('body').textContent()) ?? '';
check(
  'a wrong email is shown nothing about the order',
  !wrongText.includes('Analytical Way') && !/Qty\s*\d/i.test(wrongText),
  'order contents leaked to the wrong email',
);

await p.goto(`${BASE}/order/${ORDER}`, { waitUntil: 'domcontentloaded' });
const noEmailText = (await p.locator('body').textContent()) ?? '';
check('with no email the order is withheld', !noEmailText.includes('Analytical Way'));

await p.goto(`${BASE}/order/${ORDER}/receipt?email=someone-else@example.test`, {
  waitUntil: 'domcontentloaded',
});
const wrongReceipt = (await p.locator('body').textContent()) ?? '';
check('a wrong email is shown nothing on the receipt either', !wrongReceipt.includes('Analytical Way'));

console.log('\nPrintable receipt');
const receipt = await p.goto(`${BASE}/order/${ORDER}/receipt?email=${encodeURIComponent(EMAIL)}`, { waitUntil: 'domcontentloaded' });
check('receipt returns 200', receipt?.status() === 200, `HTTP ${receipt?.status()}`);
await p.waitForTimeout(800);
const rtext = ((await p.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
check('receipt shows the order number', rtext.includes(ORDER));
check('receipt itemises tax', /tax/i.test(rtext));
check('receipt shows a total', /Total\s*\$\d+\.\d{2}/i.test(rtext));
check('receipt has no site navigation', !(await p.locator('header nav').count()));
await p.screenshot({ path: '.audit/receipt.png', fullPage: true });

console.log('\nGuest lookup');
await p.goto(`${BASE}/orders/lookup`, { waitUntil: 'domcontentloaded' });
await p.fill('#orderNumber', ORDER);
await p.fill('#email', EMAIL);
await p.getByRole('button', { name: /find my order/i }).click();
await p.waitForTimeout(3000);
check('lookup with the right pair opens the order', p.url().includes(`/order/${ORDER}`), p.url());

await p.goto(`${BASE}/orders/lookup`, { waitUntil: 'domcontentloaded' });
await p.fill('#orderNumber', ORDER);
await p.fill('#email', 'nobody@example.test');
await p.getByRole('button', { name: /find my order/i }).click();
await p.waitForTimeout(3000);
check('lookup with a wrong email is refused', p.url().includes('error=1'), p.url());

check('no uncaught page errors', errors.filter(e => !/localhost:3000/.test(e)).length === 0, errors[0]);

await b.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
for (const f of fails) console.log('  FAILED: ' + f);
if (fail) process.exit(1);
