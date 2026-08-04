import 'server-only';

import { createHash } from 'node:crypto';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The image pipeline.
 *
 * ## Where the work actually happens
 *
 * Almost nowhere in this file, and that is the design. Cloudinary already does
 * format negotiation, resizing, compression and CDN delivery, and it does them
 * at the edge rather than in a serverless function with a cold start and a
 * memory cap. Re-implementing that with `sharp` would mean holding a 20MB TIFF
 * in a 1GB function, writing six derivatives, uploading them, and paying for
 * all of it — to produce something worse than a URL parameter.
 *
 * So this module does the four things a transformation URL cannot:
 *
 *   1. Builds the right URLs (`f_auto` for AVIF/WebP, `q_auto` for quality,
 *      a responsive width ladder).
 *   2. Detects duplicates by content hash before an asset is ever stored.
 *   3. Records what happened, so a compression step that silently stopped
 *      running is visible.
 *   4. Flags assets missing alt text, because that is an accessibility
 *      failure nobody notices without a list.
 *
 * When Cloudinary is not configured the URLs pass through untouched and the
 * storefront still works — degraded to unoptimised originals, which is the
 * correct failure mode for a shop that must not go dark because a CDN account
 * lapsed.
 */

/**
 * The responsive ladder.
 *
 * Chosen from the layout's real breakpoints rather than round numbers: a card
 * is ~320px on mobile and ~400px on desktop, a gallery is ~800px, a zoom view
 * is ~1600px. Every extra width is another CDN derivative to generate and pay
 * for, so the ladder stops where the design stops.
 */
export const IMAGE_WIDTHS = [320, 480, 640, 800, 1200, 1600] as const;

export interface ImageVariant {
  width: number;
  url: string;
}

function cloudName(): string | null {
  return process.env.CLOUDINARY_CLOUD_NAME ?? null;
}

/**
 * Rewrites a Cloudinary URL with transformation parameters.
 *
 * `f_auto` is the whole AVIF/WebP story: Cloudinary reads the browser's
 * `Accept` header and serves AVIF to Chrome, WebP to older browsers and JPEG
 * to anything else — from one URL, with no client-side detection and no
 * `<picture>` element full of sources that go stale.
 *
 * `q_auto` picks a quality per image by analysing its content, which beats a
 * fixed number in both directions: photographic detail keeps its quality, flat
 * product shots on white get compressed far harder than a global 80 would dare.
 */
export function transformUrl(
  url: string,
  options: { width?: number; height?: number; crop?: 'fill' | 'fit' | 'limit'; quality?: 'auto' | number } = {},
): string {
  if (!url.includes('/upload/')) return url;

  const parts: string[] = ['f_auto', `q_${options.quality ?? 'auto'}`];

  if (options.width) parts.push(`w_${options.width}`);
  if (options.height) parts.push(`h_${options.height}`);
  parts.push(`c_${options.crop ?? 'limit'}`);

  // `dpr_auto` serves a 2× image to a retina screen without doubling the width
  // for everyone else.
  parts.push('dpr_auto');

  return url.replace('/upload/', `/upload/${parts.join(',')}/`);
}

/** The full `srcset` for one asset. */
export function responsiveSrcSet(url: string): string {
  if (!url.includes('/upload/')) return '';

  return IMAGE_WIDTHS.map((width) => `${transformUrl(url, { width })} ${width}w`).join(', ');
}

/**
 * The `sizes` attribute for a given layout slot.
 *
 * Getting this wrong is the most common image mistake in a responsive layout:
 * without it the browser assumes the image fills the viewport and downloads the
 * 1600px file to render it at 320px. The values mirror the grid's real
 * breakpoints.
 */
export const SIZES = {
  card: '(min-width: 1280px) 320px, (min-width: 768px) 33vw, 50vw',
  hero: '100vw',
  gallery: '(min-width: 1024px) 640px, 100vw',
  thumbnail: '96px',
} as const;

/**
 * A content hash for duplicate detection.
 *
 * Hashing the bytes rather than comparing filenames: the same product photo
 * arrives from three suppliers as `IMG_4821.jpg`, `main.jpg` and
 * `SKU-1234-1.jpg`, and storing it three times costs storage, CDN transfer and
 * a media library nobody can navigate.
 */
export function contentHash(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}

/**
 * Finds an existing asset with the same content.
 *
 * Checked before upload rather than after, so a duplicate never reaches the
 * CDN at all.
 */
export async function findDuplicate(hash: string): Promise<{ id: string; url: string } | null> {
  const existing = await prisma.media.findFirst({
    where: { checksum: hash },
    select: { id: true, url: true },
  });

  return existing;
}

export interface OptimizeResult {
  mediaId: string;
  operations: string[];
  /** Null when Cloudinary is not configured and the original passes through. */
  savedBytes: number | null;
}

/**
 * Records the optimisation of one asset.
 *
 * Called by the `media.optimize` job after an upload. The transformations
 * themselves are applied by the CDN on first request, so what this does is
 * assert the derivatives are reachable and write down what was produced —
 * which is how a broken pipeline becomes visible rather than merely slow.
 */
export async function optimizeMedia(mediaId: string): Promise<OptimizeResult> {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, url: true, type: true, bytes: true, alt: true, width: true, height: true },
  });

  if (!media) throw new Error(`No media with id ${mediaId}`);

  const operations: string[] = [];
  const started = Date.now();

  if (!cloudName() || !media.url.includes('/upload/')) {
    // Nothing to do, and that is worth recording: an asset that was never
    // optimised should be findable later rather than assumed fine.
    await prisma.mediaOptimizationLog.create({
      data: {
        mediaId,
        operation: 'skipped',
        message: 'Not a Cloudinary asset; served as uploaded.',
        originalBytes: media.bytes ?? null,
        durationMs: Date.now() - started,
      },
    });

    return { mediaId, operations: ['skipped'], savedBytes: null };
  }

  /*
   * Warm the ladder.
   *
   * The first request for each derivative is what makes Cloudinary generate
   * it, and that request is slow. Doing it here means a customer never pays
   * that cost — the alternative is the first visitor to every new product
   * waiting on six cold transformations.
   */
  let optimizedBytes = 0;

  for (const width of IMAGE_WIDTHS) {
    const url = transformUrl(media.url, { width });

    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        optimizedBytes += Number(response.headers.get('content-length') ?? 0);
        operations.push(`w_${width}`);
      }
    } catch {
      // A warm-up failure is not an upload failure. The derivative will be
      // generated on demand instead.
    }
  }

  const savedBytes =
    media.bytes && optimizedBytes > 0 ? Math.max(0, media.bytes * IMAGE_WIDTHS.length - optimizedBytes) : null;

  await prisma.mediaOptimizationLog.create({
    data: {
      mediaId,
      operation: 'responsive',
      originalBytes: media.bytes ?? null,
      optimizedBytes: optimizedBytes || null,
      format: 'auto',
      width: media.width ?? null,
      height: media.height ?? null,
      durationMs: Date.now() - started,
      message: `Generated ${operations.length} of ${IMAGE_WIDTHS.length} widths.`,
    },
  });

  logger.info('media.optimized', { mediaId, widths: operations.length, savedBytes });

  return { mediaId, operations, savedBytes };
}

/**
 * Assets with no alt text.
 *
 * A list, because alt text is the accessibility failure that is invisible to
 * everyone who does not need it. It never surfaces in review, never breaks a
 * build, and is only noticed by the person it excludes.
 */
export async function missingAltText(limit = 100): Promise<
  { id: string; url: string; usedBy: string | null }[]
> {
  const rows = await prisma.media.findMany({
    where: {
      type: 'IMAGE',
      OR: [{ alt: null }, { alt: '' }],
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      productMedia: { take: 1, select: { product: { select: { name: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    usedBy: row.productMedia[0]?.product.name ?? null,
  }));
}

/** Pipeline health, for the performance dashboard. */
export async function mediaStats(): Promise<{
  total: number;
  missingAlt: number;
  optimized: number;
  totalBytes: number;
  cdnConfigured: boolean;
}> {
  const [total, missingAlt, optimized, size] = await Promise.all([
    prisma.media.count(),
    prisma.media.count({ where: { type: 'IMAGE', OR: [{ alt: null }, { alt: '' }] } }),
    prisma.mediaOptimizationLog.groupBy({ by: ['mediaId'] }).then((rows) => rows.length),
    prisma.media.aggregate({ _sum: { bytes: true } }),
  ]);

  return {
    total,
    missingAlt,
    optimized,
    totalBytes: size._sum.bytes ?? 0,
    cdnConfigured: Boolean(cloudName()),
  };
}
