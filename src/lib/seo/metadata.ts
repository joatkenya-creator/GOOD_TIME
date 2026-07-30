import type { Metadata } from 'next';

import { seoConfig } from '@/config/seo';
import { siteConfig } from '@/config/site';
import { absoluteUrl, canonicalUrl } from '@/lib/seo/url';

export interface MetadataInput {
  title?: string;
  description?: string;
  /** Path relative to the site root, e.g. `/products/silk-mist`. */
  path?: string;
  /** Absolute or root-relative image URL. Falls back to the brand OG image. */
  image?: string;
  imageAlt?: string;
  keywords?: string[];
  noindex?: boolean;
  nofollow?: boolean;
  type?: 'website' | 'article' | 'product';
  publishedTime?: Date | string;
  modifiedTime?: Date | string;
  authors?: string[];
  /** Overrides for canonical query parameters that genuinely change content. */
  canonicalParams?: Record<string, string | number>;
}

/**
 * Single entry point for page metadata.
 *
 * Phase 1 ships the helper only; pages start calling it in phase 2. Keeping this
 * centralised is what stops the "every page invents its own OG tags" drift that
 * quietly wrecks link previews.
 */
export function buildMetadata(input: MetadataInput = {}): Metadata {
  const title = input.title ?? seoConfig.defaultTitle;
  const description = input.description ?? seoConfig.defaultDescription;
  const path = input.path ?? '/';
  const canonical = canonicalUrl(path, input.canonicalParams);
  const image = absoluteUrl(input.image ?? seoConfig.defaultOgImage);

  return {
    title,
    description,
    keywords: input.keywords,
    alternates: { canonical },
    robots: {
      index: !input.noindex,
      follow: !input.nofollow,
      googleBot: {
        index: !input.noindex,
        follow: !input.nofollow,
        // Let Google build rich previews; the default is far more restrictive.
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: input.type === 'product' ? 'website' : (input.type ?? 'website'),
      siteName: siteConfig.name,
      locale: siteConfig.locale.replace('-', '_'),
      url: canonical,
      title,
      description,
      images: [
        {
          url: image,
          width: seoConfig.ogImageSize.width,
          height: seoConfig.ogImageSize.height,
          alt: input.imageAlt ?? title,
        },
      ],
      ...(input.type === 'article'
        ? {
            publishedTime: toIsoString(input.publishedTime),
            modifiedTime: toIsoString(input.modifiedTime),
            authors: input.authors,
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
      ...(siteConfig.twitterHandle ? { site: siteConfig.twitterHandle } : {}),
    },
  };
}

/**
 * Root metadata. Applied once in the root layout; page-level `buildMetadata`
 * output is merged over it by Next.
 */
export function buildRootMetadata(): Metadata {
  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: seoConfig.defaultTitle,
      template: seoConfig.titleTemplate,
    },
    description: seoConfig.defaultDescription,
    applicationName: siteConfig.name,
    referrer: 'strict-origin-when-cross-origin',
    formatDetection: { telephone: false, address: false, email: false },
    ...(seoConfig.verification.google
      ? { verification: { google: seoConfig.verification.google } }
      : {}),
    ...buildMetadata(),
  };
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.toISOString();
}
