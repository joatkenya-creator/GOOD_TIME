import { publicEnv } from '@/lib/env.public';

/**
 * Cloudinary delivery helpers.
 *
 * Transformations are built into the URL rather than baked into the stored asset,
 * so a design change never requires re-uploading 100k product images.
 */

const CLOUDINARY_BASE = 'https://res.cloudinary.com';

export interface ImageTransform {
  width?: number;
  height?: number;
  /** `fill` crops to the box; `fit` letterboxes inside it. */
  crop?: 'fill' | 'fit' | 'limit' | 'thumb';
  quality?: number | 'auto';
  format?: 'auto' | 'webp' | 'avif' | 'jpg';
  gravity?: 'auto' | 'center';
  blur?: number;
}

export function cloudinaryUrl(publicId: string, transform: ImageTransform = {}): string {
  const cloudName = publicEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return publicId; // not configured yet; caller falls back to a placeholder

  const parts = [
    `f_${transform.format ?? 'auto'}`,
    `q_${transform.quality ?? 'auto'}`,
    transform.width && `w_${transform.width}`,
    transform.height && `h_${transform.height}`,
    transform.crop && `c_${transform.crop}`,
    transform.gravity && `g_${transform.gravity}`,
    transform.blur && `e_blur:${transform.blur}`,
  ].filter(Boolean);

  return `${CLOUDINARY_BASE}/${cloudName}/image/upload/${parts.join(',')}/${publicId}`;
}

/**
 * Tiny blurred placeholder for `next/image`'s `blurDataURL`. Requesting a 24px
 * wide, heavily compressed version costs almost nothing and removes the flash of
 * empty space that otherwise hurts CLS on product grids.
 */
export function blurPlaceholderUrl(publicId: string): string {
  return cloudinaryUrl(publicId, { width: 24, quality: 30, blur: 400 });
}

/**
 * Canonical `sizes` strings. Getting these wrong is the single most common cause
 * of a bad LCP score — the browser downloads a 1920px image for a 320px slot.
 */
export const IMAGE_SIZES = {
  /** 4-up grid on desktop, 2-up on mobile. */
  productGrid: '(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw',
  /** Main image on a product detail page. */
  productHero: '(min-width: 1024px) 50vw, 100vw',
  /** Full-bleed banner. */
  banner: '100vw',
  /** Fixed-size thumbnail in the cart or order history. */
  thumbnail: '96px',
} as const;

export const ASPECT_RATIOS = {
  product: 3 / 4,
  banner: 21 / 9,
  square: 1,
} as const;
