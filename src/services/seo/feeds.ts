import 'server-only';

import { siteConfig } from '@/config/site';
import { remember, keys } from '@/lib/cache/store';
import { prisma } from '@/lib/prisma';
import { transformUrl } from '@/services/media/pipeline';

/**
 * Machine-readable exports: sitemaps and the Google Merchant feed.
 *
 * All generated on request from live data and cached briefly, rather than
 * written to disk on a schedule. A file on disk is a file that can be stale,
 * and "the sitemap still lists products we deleted last Tuesday" is a problem
 * that only ever surfaces in Search Console weeks later.
 *
 * ## The 50,000 limit
 *
 * A sitemap may hold 50,000 URLs or 50MB uncompressed. At a hundred thousand
 * products that is at least three files plus an index, which is why the
 * pagination below exists rather than being deferred until it breaks.
 */

const MAX_URLS_PER_SITEMAP = 45_000;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absolute(path: string): string {
  return path.startsWith('http')
    ? path
    : `${siteConfig.url}${path.startsWith('/') ? '' : '/'}${path}`;
}

// ---------------------------------------------------------------------------
// Image sitemap
// ---------------------------------------------------------------------------

/**
 * Product pages with their images.
 *
 * Image search is a real acquisition channel for a visual category, and the
 * standard sitemap carries no image information at all — Google has to
 * discover them by rendering each page, which for a hundred thousand products
 * it will not reliably do.
 */
export async function imageSitemap(page = 0): Promise<string> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', deletedAt: null, media: { some: {} } },
    orderBy: { id: 'asc' },
    skip: page * MAX_URLS_PER_SITEMAP,
    take: MAX_URLS_PER_SITEMAP,
    select: {
      slug: true,
      name: true,
      updatedAt: true,
      primaryCategory: { select: { path: true } },
      media: {
        orderBy: { position: 'asc' },
        take: 10,
        select: { media: { select: { url: true, alt: true } } },
      },
    },
  });

  const entries = products
    .map((product) => {
      const path = product.primaryCategory?.path
        ? `/shop/${product.primaryCategory.path}/${product.slug}`
        : `/shop/${product.slug}`;

      const images = product.media
        .map(
          (entry) => `
    <image:image>
      <image:loc>${escapeXml(transformUrl(entry.media.url, { width: 1200 }))}</image:loc>
      <image:title>${escapeXml(entry.media.alt ?? product.name)}</image:title>
    </image:image>`,
        )
        .join('');

      return `  <url>
    <loc>${escapeXml(absolute(path))}</loc>
    <lastmod>${product.updatedAt.toISOString()}</lastmod>${images}
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
}

// ---------------------------------------------------------------------------
// Video sitemap
// ---------------------------------------------------------------------------

/**
 * Video sitemap.
 *
 * Architecture only, and honest about it: the media library stores images, so
 * this returns a valid empty sitemap rather than nothing. That is deliberate —
 * an empty valid sitemap is a working endpoint waiting for content, whereas a
 * 404 has to be noticed and wired up later.
 */
export async function videoSitemap(): Promise<string> {
  const videos = await prisma.media.findMany({
    where: { type: 'VIDEO' },
    take: MAX_URLS_PER_SITEMAP,
    select: { url: true, alt: true, createdAt: true },
  });

  const entries = videos
    .map(
      (video) => `  <url>
    <loc>${escapeXml(absolute('/shop'))}</loc>
    <video:video>
      <video:thumbnail_loc>${escapeXml(video.url)}</video:thumbnail_loc>
      <video:title>${escapeXml(video.alt ?? 'Product video')}</video:title>
      <video:description>${escapeXml(video.alt ?? 'Product video')}</video:description>
      <video:content_loc>${escapeXml(video.url)}</video:content_loc>
      <video:publication_date>${video.createdAt.toISOString()}</video:publication_date>
    </video:video>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}
</urlset>`;
}

// ---------------------------------------------------------------------------
// News sitemap
// ---------------------------------------------------------------------------

/**
 * News sitemap — architecture, per the brief.
 *
 * Google News only accepts articles from publications accepted into it, and
 * only those published in the last 48 hours. A shop's buying guides are not
 * news and submitting them would be rejected, so this emits the correct
 * structure over the last two days of posts and goes no further. The endpoint
 * exists; applying to Google News is a business decision, not a code one.
 */
export async function newsSitemap(): Promise<string> {
  const since = new Date(Date.now() - 2 * 86_400_000);

  const posts = await prisma.post.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: since } },
    orderBy: { publishedAt: 'desc' },
    take: 1000,
    select: { slug: true, title: true, publishedAt: true },
  });

  const entries = posts
    .map(
      (post) => `  <url>
    <loc>${escapeXml(absolute(`/guides/${post.slug}`))}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(siteConfig.name)}</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${post.publishedAt?.toISOString() ?? ''}</news:publication_date>
      <news:title>${escapeXml(post.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries}
</urlset>`;
}

// ---------------------------------------------------------------------------
// Sitemap index
// ---------------------------------------------------------------------------

/** Points at every sitemap, which is what gets submitted to Search Console. */
export async function sitemapIndex(): Promise<string> {
  const productCount = await prisma.product.count({
    where: { status: 'ACTIVE', deletedAt: null },
  });

  const pages = Math.max(1, Math.ceil(productCount / MAX_URLS_PER_SITEMAP));
  const now = new Date().toISOString();

  const entries = [
    `${siteConfig.url}/sitemap.xml`,
    ...Array.from(
      { length: pages },
      (_, index) => `${siteConfig.url}/sitemap-images.xml?page=${index}`,
    ),
    `${siteConfig.url}/sitemap-videos.xml`,
    `${siteConfig.url}/sitemap-news.xml`,
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (loc) => `  <sitemap>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`,
  )
  .join('\n')}
</sitemapindex>`;
}

// ---------------------------------------------------------------------------
// Google Merchant Center
// ---------------------------------------------------------------------------

/**
 * The product feed, in Google Merchant's RSS 2.0 dialect.
 *
 * Two things this does that a naive feed does not:
 *
 * **It omits what it cannot state truthfully.** A product with no image, no
 * price or no description is skipped rather than submitted with blanks —
 * Merchant Center rejects those anyway, and a feed with a 40% rejection rate
 * buries the items that genuinely need fixing.
 *
 * **It respects the adult-content flag.** Google requires `adult` on items
 * that need it, and this catalogue is almost entirely such items. Getting that
 * wrong risks the whole account, not one listing — so the default is `yes` and
 * the exception must be explicit.
 */
export async function merchantFeed(): Promise<string> {
  return remember(
    keys.merchantFeed(),
    900,
    async () => {
      const products = await prisma.product.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        take: 50_000,
        select: {
          slug: true,
          name: true,
          shortDescription: true,
          description: true,
          sku: true,
          barcode: true,
          currency: true,
          minPriceCents: true,
          isAdultOnly: true,
          brand: { select: { name: true } },
          primaryCategory: { select: { name: true, path: true } },
          media: {
            take: 1,
            orderBy: { position: 'asc' },
            select: { media: { select: { url: true } } },
          },
          variants: {
            take: 1,
            where: { isActive: true, deletedAt: null },
            select: {
              priceCents: true,
              salePriceCents: true,
              inventory: { select: { quantity: true, reserved: true } },
            },
          },
        },
      });

      const items = products
        .map((product) => {
          const variant = product.variants[0];
          const image = product.media[0]?.media.url;
          const description = product.shortDescription ?? product.description;

          // Skipped rather than submitted incomplete — see above.
          if (!variant || !image || !description) return null;

          const path = product.primaryCategory?.path
            ? `/shop/${product.primaryCategory.path}/${product.slug}`
            : `/shop/${product.slug}`;

          const available = variant.inventory
            ? variant.inventory.quantity - variant.inventory.reserved > 0
            : false;

          const price = variant.salePriceCents ?? variant.priceCents;

          return `  <item>
    <g:id>${escapeXml(product.sku ?? product.slug)}</g:id>
    <g:title>${escapeXml(product.name.slice(0, 150))}</g:title>
    <g:description>${escapeXml(description.replace(/<[^>]*>/g, ' ').slice(0, 5000))}</g:description>
    <g:link>${escapeXml(absolute(path))}</g:link>
    <g:image_link>${escapeXml(transformUrl(image, { width: 1200 }))}</g:image_link>
    <g:availability>${available ? 'in_stock' : 'out_of_stock'}</g:availability>
    <g:price>${(price / 100).toFixed(2)} ${escapeXml(product.currency)}</g:price>
    <g:condition>new</g:condition>
    <g:adult>${product.isAdultOnly === false ? 'no' : 'yes'}</g:adult>
    ${product.brand ? `<g:brand>${escapeXml(product.brand.name)}</g:brand>` : ''}
    ${product.barcode ? `<g:gtin>${escapeXml(product.barcode)}</g:gtin>` : ''}
    ${product.sku ? `<g:mpn>${escapeXml(product.sku)}</g:mpn>` : ''}
    ${
      product.primaryCategory
        ? `<g:product_type>${escapeXml(product.primaryCategory.name)}</g:product_type>`
        : ''
    }
    <g:identifier_exists>${product.barcode ? 'yes' : 'no'}</g:identifier_exists>
  </item>`;
        })
        .filter(Boolean)
        .join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(siteConfig.name)}</title>
    <link>${escapeXml(siteConfig.url)}</link>
    <description>${escapeXml(siteConfig.description)}</description>
${items}
  </channel>
</rss>`;
    },
    ['products', 'feed'],
  );
}

/** How many products the feed would skip, and why. For the SEO dashboard. */
export async function merchantFeedHealth(): Promise<{
  eligible: number;
  skippedNoImage: number;
  skippedNoDescription: number;
  skippedNoPrice: number;
}> {
  const [total, noImage, noDescription, noPrice] = await Promise.all([
    prisma.product.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.product.count({ where: { status: 'ACTIVE', deletedAt: null, media: { none: {} } } }),
    prisma.product.count({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        shortDescription: null,
        OR: [{ description: null }, { description: '' }],
      },
    }),
    prisma.product.count({
      where: { status: 'ACTIVE', deletedAt: null, variants: { none: { isActive: true } } },
    }),
  ]);

  return {
    eligible: Math.max(0, total - noImage - noPrice),
    skippedNoImage: noImage,
    skippedNoDescription: noDescription,
    skippedNoPrice: noPrice,
  };
}
