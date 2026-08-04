import { NextResponse } from 'next/server';

import { videoSitemap } from '@/services/seo/feeds';

/** `GET /sitemap-videos.xml` — empty but valid until the library holds video. */
export async function GET(): Promise<NextResponse> {
  const xml = await videoSitemap();

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
