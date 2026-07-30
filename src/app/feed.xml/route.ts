import { siteConfig } from '@/config/site';
import { cacheControl } from '@/lib/cache/cached';
import { escapeHtml } from '@/lib/security/sanitize';
import { absoluteUrl } from '@/lib/seo/url';

/**
 * RSS 2.0 feed for the journal.
 *
 * Hand-rolled because the output is thirty lines of XML — an RSS builder
 * dependency would be more code to configure than to write.
 *
 * Phase 1 emits a valid, empty channel. Wiring in posts is one `prisma.post.findMany`
 * once the blog exists; the envelope below does not change.
 */
/** Segment config must be a literal — Next reads it statically, before evaluation. */
export const revalidate = 3_600; // 1h

interface FeedItem {
  title: string;
  description: string;
  path: string;
  publishedAt: Date;
}

function renderItem(item: FeedItem): string {
  const url = absoluteUrl(item.path);
  return `    <item>
      <title>${escapeHtml(item.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeHtml(item.description)}</description>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
    </item>`;
}

export async function GET(): Promise<Response> {
  const items: FeedItem[] = [];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(siteConfig.name)} — Journal</title>
    <link>${absoluteUrl('/journal')}</link>
    <description>${escapeHtml(siteConfig.description)}</description>
    <language>${siteConfig.locale}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${absoluteUrl('/feed.xml')}" rel="self" type="application/rss+xml" />
${items.map(renderItem).join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': cacheControl.static,
    },
  });
}
