import 'server-only';

import { siteConfig } from '@/config/site';

/**
 * The structured-data types phase 3 did not need.
 *
 * `json-ld.ts` already covers Organization, WebSite, BreadcrumbList, Product,
 * Article and FAQPage. These are the rest of the brief: the review and offer
 * fragments that make a product rich result complete, the search action that
 * puts a search box in Google's own results, and LocalBusiness for the day
 * there is a physical address.
 *
 * ## The rule that governs all of it
 *
 * Structured data must describe **what is actually on the page**. Marking up a
 * rating that is not displayed, or an offer at a price the customer will not
 * be charged, is a manual-action risk and — more to the point — a lie told to
 * a machine on the shop's behalf. Every builder here takes its values from the
 * same source the page renders from.
 */

type JsonLdObject = Record<string, unknown>;

const BASE = siteConfig.url;

/**
 * Offer, with availability and a price valid-until date.
 *
 * `priceValidUntil` is not decoration: without it Google may keep showing a
 * price it scraped weeks ago, and a shopper arriving at a different number is
 * the complaint that follows. A year out is the convention.
 */
export function offerSchema(input: {
  url: string;
  priceCents: number;
  currency: string;
  inStock: boolean;
  itemCondition?: 'NewCondition' | 'UsedCondition' | 'RefurbishedCondition';
  priceValidUntil?: Date;
  sellerName?: string;
}): JsonLdObject {
  const validUntil = input.priceValidUntil ?? new Date(Date.now() + 365 * 86_400_000);

  return {
    '@type': 'Offer',
    url: input.url.startsWith('http') ? input.url : `${BASE}${input.url}`,
    price: (input.priceCents / 100).toFixed(2),
    priceCurrency: input.currency,
    priceValidUntil: validUntil.toISOString().slice(0, 10),
    itemCondition: `https://schema.org/${input.itemCondition ?? 'NewCondition'}`,
    availability: `https://schema.org/${input.inStock ? 'InStock' : 'OutOfStock'}`,
    seller: { '@type': 'Organization', name: input.sellerName ?? siteConfig.name },
  };
}

/**
 * AggregateRating.
 *
 * Returns null below a threshold rather than emitting a rating built on one
 * review. A single five-star review rendered as "5.0" in a search result is
 * technically true and practically misleading, and Google's own guidance is to
 * omit it.
 */
export function aggregateRatingSchema(input: {
  ratingValue: number;
  reviewCount: number;
  minimum?: number;
}): JsonLdObject | null {
  const minimum = input.minimum ?? 3;
  if (input.reviewCount < minimum || input.ratingValue <= 0) return null;

  return {
    '@type': 'AggregateRating',
    ratingValue: input.ratingValue.toFixed(1),
    reviewCount: input.reviewCount,
    bestRating: 5,
    worstRating: 1,
  };
}

/** An individual review, for the handful shown on the page. */
export function reviewSchema(input: {
  author: string;
  rating: number;
  title?: string;
  body: string;
  datePublished: Date;
}): JsonLdObject {
  return {
    '@type': 'Review',
    author: { '@type': 'Person', name: input.author },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: input.rating,
      bestRating: 5,
      worstRating: 1,
    },
    ...(input.title ? { name: input.title } : {}),
    reviewBody: input.body.slice(0, 1500),
    datePublished: input.datePublished.toISOString().slice(0, 10),
  };
}

/**
 * SearchAction — the sitelinks search box.
 *
 * Tells Google the shop has its own search and how to call it, which can put a
 * search field directly in the branded result. Belongs on the homepage only;
 * repeating it on every page is noise.
 */
export function searchActionSchema(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: BASE,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * ItemList — for category and collection pages.
 *
 * Gives Google an ordered list of what a listing page contains, which is how a
 * category page earns a carousel rather than a single blue link.
 */
export function itemListSchema(
  items: { url: string; name: string; imageUrl?: string; priceCents?: number; currency?: string }[],
  listName: string,
): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 30).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: item.url.startsWith('http') ? item.url : `${BASE}${item.url}`,
      name: item.name,
      ...(item.imageUrl ? { image: item.imageUrl } : {}),
    })),
  };
}

/**
 * LocalBusiness — future-ready, and deliberately inert.
 *
 * Emitting a LocalBusiness with no verifiable address is worse than emitting
 * nothing: it invites a Google Business Profile mismatch and, for a shop in
 * this category, publishes a physical location that may be a private residence.
 * So this returns null until a real address is configured, and the shape is
 * here so the day that happens is a settings change.
 */
export function localBusinessSchema(input?: {
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
  telephone?: string;
  openingHours?: string[];
}): JsonLdObject | null {
  if (!input?.streetAddress) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: siteConfig.name,
    url: BASE,
    address: {
      '@type': 'PostalAddress',
      streetAddress: input.streetAddress,
      addressLocality: input.addressLocality,
      addressRegion: input.addressRegion,
      postalCode: input.postalCode,
      addressCountry: input.addressCountry,
    },
    ...(input.telephone ? { telephone: input.telephone } : {}),
    ...(input.openingHours ? { openingHoursSpecification: input.openingHours } : {}),
  };
}

/**
 * VideoObject — for product demonstration video, when there is any.
 *
 * The shape exists because the video sitemap needs it and because a product
 * video that Google cannot see is a video nobody watches. Nothing calls it yet;
 * the media library stores images only.
 */
export function videoSchema(input: {
  name: string;
  description: string;
  thumbnailUrl: string;
  contentUrl: string;
  uploadDate: Date;
  durationSeconds?: number;
}): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: input.name,
    description: input.description,
    thumbnailUrl: input.thumbnailUrl,
    contentUrl: input.contentUrl,
    uploadDate: input.uploadDate.toISOString(),
    ...(input.durationSeconds
      ? { duration: `PT${Math.floor(input.durationSeconds / 60)}M${input.durationSeconds % 60}S` }
      : {}),
  };
}

/** CollectionPage, for a curated collection with its own copy. */
export function collectionPageSchema(input: {
  name: string;
  description: string;
  url: string;
  itemCount: number;
}): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
    description: input.description,
    url: input.url.startsWith('http') ? input.url : `${BASE}${input.url}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: input.itemCount,
    },
  };
}

/**
 * Person, for a blog author page.
 *
 * Author identity is part of how Google assesses expertise, and in a category
 * where advice carries real consequences, an article with no attributable
 * author is one it has every reason to discount.
 */
export function personSchema(input: {
  name: string;
  url: string;
  description?: string;
  imageUrl?: string;
  sameAs?: string[];
}): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.name,
    url: input.url.startsWith('http') ? input.url : `${BASE}${input.url}`,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(input.sameAs?.length ? { sameAs: input.sameAs } : {}),
  };
}

/** Serialises to a `<script>` body, escaping the one sequence that can break out. */
export function jsonLdString(schema: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
