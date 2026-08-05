import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cloudinary URL building.
 *
 * The failures here are all silent. A wrong `f_auto` ships a WebP into Outlook
 * where it renders as nothing; an invented width creates a derived asset that
 * is billed forever; a missing cloud name returns a string that looks like a
 * URL and 404s. None of them throw, and none are visible in a screenshot of a
 * Chrome window.
 */

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'demo-cloud');
  return import('@/lib/performance/image');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('presets', () => {
  it('serves modern formats and automatic quality by default', async () => {
    const { presetUrl } = await load();

    const url = presetUrl('products/lumen.jpg', 'card');

    // `f_auto` is the entire AVIF/WebP story — Cloudinary reads the Accept
    // header and picks. Losing it silently ships JPEG to everyone.
    expect(url).toContain('f_auto');
    expect(url).toContain('q_auto');
    expect(url).toContain('res.cloudinary.com/demo-cloud');
  });

  it('pins email and Open Graph to JPEG', async () => {
    const { presetUrl } = await load();

    /*
     * Outlook renders neither WebP nor AVIF — the image is simply absent, in a
     * receipt, on a phone. Several social scrapers fetch with no Accept header
     * at all, so there is nothing to negotiate with.
     */
    expect(presetUrl('x.jpg', 'email')).toContain('f_jpg');
    expect(presetUrl('x.jpg', 'email')).not.toContain('f_auto');
    expect(presetUrl('x.jpg', 'openGraph')).toContain('f_jpg');
  });

  it('sizes the Open Graph card exactly, because the platforms crop otherwise', async () => {
    const { presetUrl } = await load();

    const url = presetUrl('x.jpg', 'openGraph');
    expect(url).toContain('w_1200');
    expect(url).toContain('h_630');
    expect(url).toContain('c_fill');
  });

  it('fits the product hero rather than cropping it', async () => {
    const { presetUrl, IMAGE_PRESETS } = await load();

    // Cropping a product photo hides the thing being sold, and a customer who
    // buys what they saw and receives what was cropped out is a return.
    expect(IMAGE_PRESETS.hero.crop).toBe('fit');
    expect(presetUrl('x.jpg', 'hero')).toContain('c_fit');
    expect(IMAGE_PRESETS.card.crop).toBe('fill');
  });
});

describe('srcset', () => {
  it('never exceeds the preset width', async () => {
    const { presetSrcSet } = await load();

    const widths = presetSrcSet('x.jpg', 'card')
      .split(', ')
      .map((entry) => Number(entry.split(' ')[1]!.replace('w', '')));

    // Offering a 1920w candidate for a 480px preset invites the browser to
    // download four times the bytes it can use.
    expect(Math.max(...widths)).toBeLessThanOrEqual(480);
    expect(widths.length).toBeGreaterThan(1);
  });

  it('only offers widths Next already declares', async () => {
    const { presetSrcSet } = await load();

    const declared = new Set([360, 480, 640, 768, 1024, 1280, 1536, 1920]);
    const widths = presetSrcSet('x.jpg', 'hero')
      .split(', ')
      .map((entry) => Number(entry.split(' ')[1]!.replace('w', '')));

    /*
     * Every distinct width is a derived asset Cloudinary stores and bills for.
     * Keeping the set closed is what makes the cost proportional to the number
     * of layouts rather than the number of components.
     */
    for (const width of widths) expect(declared.has(width)).toBe(true);
  });

  it('is a valid srcset, not a string that merely looks like one', async () => {
    const { presetSrcSet } = await load();

    for (const entry of presetSrcSet('x.jpg', 'banner').split(', ')) {
      expect(entry).toMatch(/^https:\/\/res\.cloudinary\.com\/\S+ \d+w$/);
    }
  });
});

describe('when Cloudinary is not configured', () => {
  it('returns the public id rather than a broken URL', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', '');

    const { presetUrl } = await import('@/lib/performance/image');

    // The caller falls back to a placeholder. Emitting
    // `res.cloudinary.com/undefined/...` would 404 on every image on the site
    // and look like a Cloudinary outage rather than a missing variable.
    expect(presetUrl('products/lumen.jpg', 'card')).toBe('products/lumen.jpg');
  });
});
