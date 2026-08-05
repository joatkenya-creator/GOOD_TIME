/**
 * Broken links, missing images and duplicate metadata, across the whole site.
 *
 *   npm run build && npx next start -p 3000
 *   npm run verify:links
 *
 * ## Crawls, rather than checking a list
 *
 * A hand-maintained list of URLs only ever checks the pages someone remembered.
 * This starts at the sitemap and follows every internal link it finds, which is
 * how it catches the page that was renamed six months ago and is still linked
 * from a footer nobody edits.
 *
 * ## Three classes of problem, one pass
 *
 *   - **Broken links** — a 404 or 5xx behind an `<a href>`. Every one of them
 *     is a customer who hit a dead end and a crawler that wasted its budget.
 *   - **Missing images** — an `<img src>` that does not resolve. These are
 *     invisible in a screenshot review because the alt text fills the space.
 *   - **Duplicate metadata** — two pages with the same title, description or
 *     canonical. Google picks one and discards the other, so a duplicate title
 *     across forty category pages means thirty-nine of them do not rank.
 *
 * Redirects are followed but reported: a 301 from an internal link is not
 * broken, but it is a link that should have been updated, and a chain of them
 * is latency on every visit.
 */

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 300);
const CONCURRENCY = 6;

/** Never crawl these: per-customer, or a state change. */
const SKIP = [
  /^\/api\//,
  /^\/admin/,
  /^\/account/,
  /^\/checkout/,
  /^\/order\//,
  /^\/sign-out/,
  /\.(?:xml|txt|json|ico|png|jpe?g|webp|avif|svg|woff2?)$/,
];

const visited = new Set();
const queue = [];

const brokenLinks = [];
const missingImages = [];
const redirects = [];
/** title/description/canonical → the pages that used it. */
const metadata = { title: new Map(), description: new Map(), canonical: new Map() };

function shouldCrawl(pathname) {
  return !SKIP.some((pattern) => pattern.test(pathname));
}

/** Absolute internal URL, or null for anything off-site or unusable. */
function normalise(href, from) {
  if (!href) return null;

  try {
    const url = new URL(href, from);
    if (url.origin !== BASE) return null;

    // The fragment is the same document; the query multiplies one page into
    // hundreds of filter permutations that all render the same template.
    url.hash = '';
    url.search = '';

    return url.href;
  } catch {
    return null;
  }
}

async function head(url) {
  try {
    // `HEAD` first: a 40MB product image does not need downloading to know it
    // exists. Some hosts refuse HEAD, hence the GET fallback.
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    if (response.status === 405 || response.status === 501) {
      return fetch(url, { method: 'GET', redirect: 'manual' });
    }
    return response;
  } catch (error) {
    return { status: 0, headers: new Headers(), error };
  }
}

function record(map, value, page) {
  if (!value) return;
  const existing = map.get(value);
  if (existing) existing.push(page);
  else map.set(value, [page]);
}

async function crawl(url) {
  const response = await fetch(url, { redirect: 'follow' });

  if (!response.ok) {
    brokenLinks.push({ url, status: response.status, from: '(entry point)' });
    return;
  }

  const html = await response.text();
  const pathname = new URL(url).pathname;

  // --- Metadata -----------------------------------------------------------
  record(metadata.title, /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim(), pathname);
  record(
    metadata.description,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]?.trim(),
    pathname,
  );
  record(
    metadata.canonical,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i.exec(html)?.[1]?.trim(),
    pathname,
  );

  // --- Images -------------------------------------------------------------
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);

  for (const source of new Set(images)) {
    // `data:` and Next's optimiser both resolve against the running server.
    const target = source.startsWith('data:') ? null : new URL(source, url).href;
    if (!target) continue;

    const result = await head(target);
    if (result.status >= 400 || result.status === 0) {
      missingImages.push({ image: source, status: result.status, on: pathname });
    }
  }

  // --- Links --------------------------------------------------------------
  const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((match) => match[1]);

  for (const href of new Set(hrefs)) {
    const target = normalise(href, url);
    if (!target) continue;

    const targetPath = new URL(target).pathname;

    const result = await head(target);

    if (result.status >= 400 || result.status === 0) {
      brokenLinks.push({ url: target, status: result.status, from: pathname });
      continue;
    }

    if (result.status >= 300 && result.status < 400) {
      redirects.push({
        from: pathname,
        url: target,
        to: result.headers.get('location'),
        status: result.status,
      });
    }

    if (
      shouldCrawl(targetPath) &&
      !visited.has(target) &&
      visited.size + queue.length < MAX_PAGES
    ) {
      queue.push(target);
    }
  }
}

async function main() {
  console.log(`Crawling ${BASE} (max ${MAX_PAGES} pages)\n`);

  // Seeded from the sitemap: it is the list we tell crawlers to use, so it is
  // the list that has to be correct.
  try {
    const sitemap = await fetch(`${BASE}/sitemap.xml`).then((response) => response.text());
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = normalise(match[1], BASE);
      if (url && shouldCrawl(new URL(url).pathname)) queue.push(url);
    }
  } catch {
    console.warn('No sitemap.xml — starting from the home page instead.\n');
  }

  if (queue.length === 0) queue.push(`${BASE}/`);

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const batch = [];

    while (batch.length < CONCURRENCY && queue.length > 0) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      batch.push(url);
    }

    await Promise.all(
      batch.map((url) =>
        crawl(url).catch((error) => {
          brokenLinks.push({ url, status: 0, from: '(crawl failed)', error: String(error) });
        }),
      ),
    );

    process.stdout.write(`\r  ${visited.size} pages, ${queue.length} queued`);
  }

  console.log('\n');

  // --- Report -------------------------------------------------------------
  let failures = 0;

  if (brokenLinks.length > 0) {
    failures += brokenLinks.length;
    console.log(`BROKEN LINKS (${brokenLinks.length})`);
    for (const entry of brokenLinks.slice(0, 40)) {
      console.log(`  ${entry.status || 'ERR'}  ${entry.url}\n        linked from ${entry.from}`);
    }
    console.log('');
  }

  if (missingImages.length > 0) {
    failures += missingImages.length;
    console.log(`MISSING IMAGES (${missingImages.length})`);
    for (const entry of missingImages.slice(0, 40)) {
      console.log(`  ${entry.status || 'ERR'}  ${entry.image}\n        on ${entry.on}`);
    }
    console.log('');
  }

  for (const [field, map] of Object.entries(metadata)) {
    const duplicates = [...map.entries()].filter(([, pages]) => pages.length > 1);

    if (duplicates.length > 0) {
      failures += duplicates.length;
      console.log(`DUPLICATE ${field.toUpperCase()} (${duplicates.length})`);

      for (const [value, pages] of duplicates.slice(0, 20)) {
        console.log(`  "${String(value).slice(0, 70)}"`);
        console.log(`        ${pages.join('\n        ')}`);
      }
      console.log('');
    }
  }

  if (redirects.length > 0) {
    // Reported, never fatal. An internal link through a 301 works; it is just
    // a link somebody forgot to update, and a chain of them is real latency.
    console.log(`INTERNAL REDIRECTS (${redirects.length}) — not failures, but worth fixing`);
    for (const entry of redirects.slice(0, 15)) {
      console.log(
        `  ${entry.status}  ${entry.url} -> ${entry.to}\n        linked from ${entry.from}`,
      );
    }
    console.log('');
  }

  console.log(
    failures === 0
      ? `PASS — ${visited.size} pages, no broken links, no missing images, no duplicate metadata.`
      : `FAIL — ${failures} problems across ${visited.size} pages.`,
  );

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
