import { Inter, Playfair_Display } from 'next/font/google';

/**
 * Font loading.
 *
 * `next/font` self-hosts these at build time: no request to Google's CDN, no
 * render-blocking stylesheet, and a generated fallback metric that eliminates
 * layout shift when the webfont swaps in.
 *
 * The CSS variables declared here are the ones `styles/tokens.css` points
 * `--font-sans` and `--font-display` at.
 */

/** Body text — a neutral grotesque that stays legible at 14px. */
export const fontBody = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
  // Variable font: one file covers the whole weight range we use.
  axes: ['opsz'],
});

/** Display face — the elegance in "elegant, premium". Headings only. */
export const fontHeading = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-heading',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

export const fontVariables = `${fontBody.variable} ${fontHeading.variable}`;
