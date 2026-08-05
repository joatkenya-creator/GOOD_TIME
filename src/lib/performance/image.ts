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

/**
 * Named transformation presets.
 *
 * ## Why a fixed set rather than per-call-site transforms
 *
 * Every distinct transformation is a *derived asset* Cloudinary generates,
 * stores and bills for. A call site inventing `w_437` creates one more forever.
 * A closed set keeps the derived-asset count proportional to the number of
 * layouts rather than to the number of components — and it is what makes
 * Cloudinary's "strict transformations" setting usable, which is the thing that
 * stops a stranger billing arbitrary transforms to the account.
 *
 * ## The two that are deliberately not `f_auto`
 *
 * `email` and `openGraph` are pinned to JPEG. Outlook renders neither WebP nor
 * AVIF — the image is simply missing, in a receipt, on a phone — and several
 * social scrapers fetch with no `Accept` header at all, so format negotiation
 * has nothing to negotiate with.
 */
export const IMAGE_PRESETS = {
  /** Product card in a grid. Cropped to a consistent ratio so rows line up. */
  card: { width: 480, crop: 'fill', gravity: 'auto', quality: 'auto', format: 'auto' },
  /** Main product image. `fit`, never `fill` — cropping a product is a returns problem. */
  hero: { width: 1200, crop: 'fit', quality: 'auto', format: 'auto' },
  /** Full-resolution zoom. Worth the bytes; the customer asked for it. */
  zoom: { width: 2000, crop: 'fit', quality: 'auto', format: 'auto' },
  /** Cart and order-history thumbnail. */
  thumbnail: { width: 96, height: 96, crop: 'fill', quality: 'auto', format: 'auto' },
  /** Full-bleed marketing banner. */
  banner: { width: 1920, crop: 'fill', gravity: 'auto', quality: 'auto', format: 'auto' },
  /** Email. JPEG, because Outlook renders nothing else reliably. */
  email: { width: 600, quality: 'auto', format: 'jpg' },
  /** Open Graph card. Exactly 1200x630, JPEG for the same reason. */
  openGraph: { width: 1200, height: 630, crop: 'fill', quality: 'auto', format: 'jpg' },
} as const satisfies Record<string, ImageTransform>;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/** Builds a URL from a named preset. Prefer this over an inline transform. */
export function presetUrl(publicId: string, preset: ImagePreset): string {
  return cloudinaryUrl(publicId, IMAGE_PRESETS[preset]);
}

/**
 * A `srcset` for a preset, across the widths `next.config.ts` already declares.
 *
 * Bounded to `deviceSizes` on purpose: an arbitrary width here is a new derived
 * asset, and a `srcset` of eight invented widths multiplies the billed count by
 * eight for a difference no one can see.
 */
export function presetSrcSet(publicId: string, preset: ImagePreset): string {
  const widths = [360, 480, 640, 768, 1024, 1280, 1536, 1920] as const;
  const base = IMAGE_PRESETS[preset];

  return widths
    .filter((width) => width <= (base.width ?? 1920))
    .map((width) => `${cloudinaryUrl(publicId, { ...base, width })} ${width}w`)
    .join(', ');
}
