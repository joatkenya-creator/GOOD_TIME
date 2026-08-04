import { NextResponse } from 'next/server';

import { imageSitemap } from '@/services/seo/feeds';

/**
 * `GET /sitemap-images.xml?page=0` — product images, paginated.
 *
 * The page is a query parameter rather than a path segment because Next only
 * routes a dynamic segment that occupies a *whole* segment: a folder named
 * `sitemap-images-[page].xml` is treated as a literal name and never matches.
 * A sitemap index may legally list URLs with query strings, so this costs
 * nothing but a slightly less pretty URL.
 *
 * Image search is a real acquisition channel for a visual category, and the
 * standard sitemap carries no image data at all — Google would have to render
 * every product page to discover them, which at a hundred thousand products it
 * will not reliably do.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const page = Number.parseInt(new URL(request.url).searchParams.get('page') ?? '0', 10);
  const xml = await imageSitemap(Number.isFinite(page) && page > 0 ? page : 0);

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
