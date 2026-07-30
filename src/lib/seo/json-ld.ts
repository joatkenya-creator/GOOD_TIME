import { siteConfig } from '@/config/site';
import { absoluteUrl } from '@/lib/seo/url';

/**
 * Structured-data builders.
 *
 * Google reads Schema.org JSON-LD for rich results — star ratings, price and
 * stock badges, breadcrumb trails, sitelinks search. Each builder returns a plain
 * object; `<JsonLd>` serialises it safely into the document.
 *
 * Only the graph shapes are defined here. Nothing is rendered in phase 1.
 */

export type JsonLdObject = Record<string, unknown>;

export function organizationSchema(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': absoluteUrl('/#organization'),
    name: siteConfig.name,
    legalName: siteConfig.legalName,
    url: siteConfig.url,
    logo: absoluteUrl('/logo.png'),
    description: siteConfig.description,
    sameAs: Object.values(siteConfig.social),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: siteConfig.contact.email,
      telephone: siteConfig.contact.phone,
      areaServed: siteConfig.country,
      availableLanguage: ['en'],
    },
  };
}

export function websiteSchema(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': absoluteUrl('/#website'),
    name: siteConfig.name,
    url: siteConfig.url,
    publisher: { '@id': absoluteUrl('/#organization') },
    inLanguage: siteConfig.locale,
    // Enables the sitelinks search box in Google results.
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: absoluteUrl('/search?q={search_term_string}'),
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface BreadcrumbEntry {
  name: string;
  path: string;
}

export function breadcrumbSchema(trail: BreadcrumbEntry[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.path),
    })),
  };
}

export interface ProductSchemaInput {
  name: string;
  slug: string;
  description?: string | null;
  sku: string;
  brandName?: string | null;
  images: string[];
  minPriceCents: number;
  maxPriceCents: number;
  currency: string;
  inStock: boolean;
  ratingAverage?: number;
  ratingCount?: number;
}

export function productSchema(input: ProductSchemaInput): JsonLdObject {
  const offer =
    input.minPriceCents === input.maxPriceCents
      ? {
          '@type': 'Offer',
          price: (input.minPriceCents / 100).toFixed(2),
          priceCurrency: input.currency,
          availability: input.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          url: absoluteUrl(`/products/${input.slug}`),
        }
      : {
          '@type': 'AggregateOffer',
          lowPrice: (input.minPriceCents / 100).toFixed(2),
          highPrice: (input.maxPriceCents / 100).toFixed(2),
          priceCurrency: input.currency,
          availability: input.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          url: absoluteUrl(`/products/${input.slug}`),
        };

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description ?? undefined,
    sku: input.sku,
    image: input.images,
    ...(input.brandName ? { brand: { '@type': 'Brand', name: input.brandName } } : {}),
    offers: offer,
    // Google rejects an AggregateRating with a zero count.
    ...(input.ratingCount && input.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: input.ratingAverage,
            reviewCount: input.ratingCount,
          },
        }
      : {}),
  };
}

export interface ArticleSchemaInput {
  title: string;
  slug: string;
  description?: string | null;
  image?: string | null;
  authorName: string;
  publishedAt: Date | string;
  updatedAt: Date | string;
}

export function articleSchema(input: ArticleSchemaInput): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description ?? undefined,
    image: input.image ? [input.image] : undefined,
    author: { '@type': 'Person', name: input.authorName },
    publisher: { '@id': absoluteUrl('/#organization') },
    datePublished: toIso(input.publishedAt),
    dateModified: toIso(input.updatedAt),
    mainEntityOfPage: absoluteUrl(`/journal/${input.slug}`),
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqSchema(entries: FaqEntry[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}
