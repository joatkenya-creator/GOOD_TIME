import { NextResponse } from 'next/server';

import { newsSitemap } from '@/services/seo/feeds';

/**
 * `GET /sitemap-news.xml` — the last 48 hours of posts, in Google News format.
 *
 * Only useful once the publication is accepted into Google News, which is a
 * business decision. The endpoint is correct either way.
 */
export async function GET(): Promise<NextResponse> {
  const xml = await newsSitemap();

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Short: a news sitemap that is an hour stale has missed the point.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}

export const revalidate = 300;
