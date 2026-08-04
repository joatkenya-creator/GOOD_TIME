import { NextResponse } from 'next/server';

import { sitemapIndex } from '@/services/seo/feeds';

/**
 * `GET /sitemap-index.xml` — the file to submit to Search Console.
 *
 * A single sitemap caps at 50,000 URLs, so a hundred-thousand-product
 * catalogue needs an index whether or not it has one today. Building it now
 * means crossing that line is a non-event.
 */
export async function GET(): Promise<NextResponse> {
  const xml = await sitemapIndex();

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
