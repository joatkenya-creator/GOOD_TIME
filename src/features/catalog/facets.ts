/**
 * Facet tokens.
 *
 * `Product.facets` is a flat, GIN-indexed array of `namespace:value` strings.
 * Filtering by any combination of colour, size, material, tag, brand or flag then
 * becomes a single `hasEvery` / `hasSome` predicate instead of one join per facet.
 *
 * The trade-off is that the array must be rebuilt whenever a source relation
 * changes — `rebuildProductFacets` in `src/services/product-write.service.ts` is
 * the only thing allowed to write it.
 */

export const FACET_NAMESPACES = [
  'brand',
  'category',
  'collection',
  'color',
  'size',
  'material',
  'tag',
  'flag',
  'rating',
] as const;

export type FacetNamespace = (typeof FACET_NAMESPACES)[number];

/** Normalises a value so `"Rose Gold"` and `"rose gold"` produce one token. */
export function facetToken(namespace: FacetNamespace, value: string): string {
  return `${namespace}:${value.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

export function parseFacetToken(token: string): { namespace: string; value: string } | null {
  const separator = token.indexOf(':');
  if (separator < 1) return null;
  return { namespace: token.slice(0, separator), value: token.slice(separator + 1) };
}

/**
 * Rating is stored as a floor token (`rating:4` means "4 stars and up"), so a
 * "4 stars & up" filter is a single token match rather than a range scan.
 */
export function ratingFacetTokens(average: number): string[] {
  const floor = Math.floor(average);
  return Array.from({ length: floor }, (_, index) => facetToken('rating', String(index + 1)));
}

export const FLAG_FACETS = {
  onSale: facetToken('flag', 'sale'),
  newArrival: facetToken('flag', 'new'),
  bestSeller: facetToken('flag', 'best-seller'),
  inStock: facetToken('flag', 'in-stock'),
  featured: facetToken('flag', 'featured'),
} as const;

/**
 * Groups selected tokens by namespace.
 *
 * Two filters in the *same* namespace are an OR ("red or blue"); filters across
 * namespaces are an AND ("red AND silicone"). Getting this the wrong way round
 * produces a filter UI that returns nothing as soon as two colours are picked —
 * the single most common faceted-search bug.
 */
export function groupTokensByNamespace(tokens: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const token of tokens) {
    const parsed = parseFacetToken(token);
    if (!parsed) continue;

    const existing = grouped.get(parsed.namespace);
    if (existing) existing.push(token);
    else grouped.set(parsed.namespace, [token]);
  }

  return grouped;
}

/** Human label for a token, for the "applied filters" chip row. */
export function facetLabel(token: string): string {
  const parsed = parseFacetToken(token);
  if (!parsed) return token;

  const value = parsed.value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  if (parsed.namespace === 'rating') return `${parsed.value} stars & up`;
  if (parsed.namespace === 'flag') return value;
  return value;
}
