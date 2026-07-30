import { ImageResponse } from 'next/og';

import { siteConfig } from '@/config/site';

/**
 * Generated favicon.
 *
 * Rendered at build time from the brand tokens, so there is a real tab icon
 * before anyone opens a design tool. Replace this file with `app/favicon.ico`
 * (or a static `icon.png`) once the proper brand mark exists — Next prefers a
 * static file over a generated one automatically.
 */
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: siteConfig.themeColor,
        color: '#ffffff',
        fontSize: 260,
        fontWeight: 700,
        letterSpacing: '-0.05em',
      }}
    >
      GT
    </div>,
    size,
  );
}
