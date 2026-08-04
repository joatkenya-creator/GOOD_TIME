import { NextResponse } from 'next/server';

import { merchantFeed } from '@/services/seo/feeds';

/**
 * `GET /feeds/merchant.xml` — the Google Merchant Center product feed.
 *
 * Public and cacheable: Merchant Center fetches it on its own schedule, and so
 * do affiliate networks and comparison engines. Cached for fifteen minutes at
 * the edge, which is far more often than any of them poll.
 */
export async function GET(): Promise<NextResponse> {
  const xml = await merchantFeed();

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 900;
