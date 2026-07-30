/** Combining marks left behind by NFKD normalisation (é -> e + U+0301). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * URL slug helpers. Deliberately dependency-free — `String.normalize` does the
 * accent folding that a slugify package would otherwise be installed for.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/** Appends a numeric suffix until the slug is unique within `taken`. */
export function uniqueSlug(value: string, taken: ReadonlySet<string>): string {
  const base = slugify(value);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Builds an SKU-safe token: uppercase, alphanumeric only. */
export function skuSegment(value: string): string {
  return slugify(value).toUpperCase().replace(/-/g, '');
}
