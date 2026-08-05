import 'server-only';

import { importedProductSchema } from '@/features/import/contract';
import type { RawRow } from '@/services/import/adapters';

/**
 * Mapping: a supplier's vocabulary translated into ours.
 *
 * Suppliers do not agree on column names and never will — `sku`, `SKU`,
 * `item_no`, `g:id`, `ArtikelNr` all mean the same thing. A template records
 * the translation once so the second import from that supplier is a click.
 *
 * Transforms live here rather than in the adapters because they are the same
 * whatever the file format: a price is "19.99" in CSV and in JSON alike, and it
 * has to become 1999 cents in both.
 */

export interface FieldMapping {
  /** The column in the source file. */
  from: string;
  /** Optional transform applied after extraction. */
  transform?: TransformName;
  /** Used when the source column is missing or empty. */
  fallback?: string;
}

export type TransformName =
  | 'trim'
  | 'lowercase'
  | 'uppercase'
  | 'slugify'
  | 'money_to_cents'
  | 'percent_to_basis_points'
  | 'boolean'
  | 'integer'
  | 'split_pipe'
  | 'split_comma'
  | 'strip_html'
  | 'first_of_list';

export type TemplateMapping = Record<string, FieldMapping | string>;

/** Everything the pipeline can be asked to fill. */
export const MAPPABLE_FIELDS = [
  {
    key: 'externalId',
    label: 'Supplier ID',
    required: true,
    hint: 'Stable identifier used to match on re-import',
  },
  { key: 'sku', label: 'SKU', required: true },
  { key: 'name', label: 'Product name', required: true },
  { key: 'description', label: 'Description' },
  { key: 'brandName', label: 'Brand' },
  { key: 'categoryPath', label: 'Category path', hint: 'Pipe- or slash-separated' },
  { key: 'priceCents', label: 'Price', required: true, hint: 'Use the money transform' },
  { key: 'compareAtPriceCents', label: 'Compare-at price' },
  { key: 'currency', label: 'Currency' },
  { key: 'quantity', label: 'Stock quantity' },
  { key: 'imageUrls', label: 'Image URLs', hint: 'Pipe- or comma-separated' },
  { key: 'barcode', label: 'Barcode / GTIN' },
  { key: 'weightGrams', label: 'Weight (grams)' },
  { key: 'material', label: 'Material' },
  { key: 'color', label: 'Colour' },
  { key: 'isActive', label: 'Active' },
] as const;

/**
 * Money to integer cents, without floating point.
 *
 * `parseFloat("19.99") * 100` is 1998.9999999999998, and `Math.round` hides
 * that until the day it does not. Splitting on the separator and padding the
 * fraction is exact for every input a feed can contain.
 *
 * Handles `19.99`, `19,99` (European), `$19.99`, `1 234,56` and `1,234.56`.
 */
export function moneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;

  const negative = cleaned.startsWith('-');
  const digits = negative ? cleaned.slice(1) : cleaned;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');

  let whole: string;
  let fraction: string;

  if (lastComma === -1 && lastDot === -1) {
    whole = digits;
    fraction = '';
  } else {
    // Whichever separator comes last is the decimal point; the other is a
    // thousands separator. "1,234.56" and "1.234,56" both resolve correctly.
    const separatorAt = Math.max(lastComma, lastDot);
    const tail = digits.slice(separatorAt + 1);

    if (/^\d{3}$/.test(tail) && separatorAt !== digits.length - 4 - 0) {
      // Exactly three trailing digits with more digits before is a thousands
      // group, not a fraction: "1.234" is 1234, not 1.23.
      whole = digits.replace(/[.,]/g, '');
      fraction = '';
    } else {
      whole = digits.slice(0, separatorAt).replace(/[.,]/g, '');
      fraction = tail.replace(/\D/g, '');
    }
  }

  if (!whole && !fraction) return null;

  const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;

  return negative ? -cents : cents;
}

const TRANSFORMS: Record<TransformName, (value: string) => string> = {
  trim: (value) => value.trim(),
  lowercase: (value) => value.toLowerCase(),
  uppercase: (value) => value.toUpperCase(),
  slugify: (value) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  money_to_cents: (value) => String(moneyToCents(value) ?? ''),
  percent_to_basis_points: (value) => {
    const percent = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(percent) ? String(Math.round(percent * 100)) : '';
  },
  boolean: (value) => {
    const text = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'in stock', 'available', 'active'].includes(text)
      ? 'true'
      : 'false';
  },
  integer: (value) => {
    const digits = value.replace(/[^\d-]/g, '');
    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? String(parsed) : '';
  },
  split_pipe: (value) =>
    value
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('|'),
  split_comma: (value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('|'),
  strip_html: (value) =>
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim(),
  first_of_list: (value) => (value.split(/[|,]/)[0] ?? '').trim(),
};

export const TRANSFORM_NAMES = Object.keys(TRANSFORMS) as TransformName[];

function extract(row: RawRow, mapping: FieldMapping | string): string {
  const spec: FieldMapping = typeof mapping === 'string' ? { from: mapping } : mapping;

  let value = row[spec.from] ?? '';
  if (!value && spec.fallback) value = spec.fallback;
  if (!value) return '';

  return spec.transform ? (TRANSFORMS[spec.transform]?.(value) ?? value) : value.trim();
}

export interface MappedRow {
  /** Passed to the contract schema. */
  data: Record<string, unknown>;
  /** Fields the mapping could not fill. */
  missing: string[];
}

/**
 * Applies a template to one raw row.
 *
 * Defaults fill what the feed omits — a supplier who ships no currency almost
 * certainly means their own, and asking an operator to add a `currency` column
 * to a file they do not control is not a workable answer.
 */
export function mapRow(
  row: RawRow,
  mapping: TemplateMapping,
  defaults: Record<string, unknown> = {},
): MappedRow {
  const data: Record<string, unknown> = { ...defaults };
  const missing: string[] = [];

  for (const [field, spec] of Object.entries(mapping)) {
    const value = extract(row, spec);

    if (!value) {
      if (data[field] === undefined) missing.push(field);
      continue;
    }

    switch (field) {
      case 'priceCents':
      case 'compareAtPriceCents':
      case 'quantity':
      case 'weightGrams': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) data[field] = parsed;
        break;
      }
      case 'isActive':
        data[field] = value === 'true';
        break;
      case 'categoryPath':
        // Suppliers separate category levels with pipes, slashes or " > ".
        data[field] = value
          .split(/[|>/]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .slice(0, 6);
        break;
      case 'imageUrls':
        data[field] = value
          .split(/[|,]/)
          .map((part) => part.trim())
          // Only absolute https URLs. A relative path in a supplier feed
          // resolves against *their* host, which we should not be guessing.
          .filter((part) => /^https:\/\//i.test(part))
          .slice(0, 10);
        break;
      default:
        data[field] = value;
    }
  }

  return { data, missing };
}

export interface ValidatedRow {
  ok: boolean;
  data?: ReturnType<typeof importedProductSchema.parse>;
  errors: string[];
}

/** Runs the contract schema and turns Zod's output into readable complaints. */
export function validateRow(mapped: Record<string, unknown>): ValidatedRow {
  const result = importedProductSchema.safeParse(mapped);

  if (result.success) return { ok: true, data: result.data, errors: [] };

  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'row';
      return `${path}: ${issue.message}`;
    }),
  };
}

/**
 * Guesses a mapping from the source's column names.
 *
 * A first draft, not an answer — the operator confirms it in the preview. It
 * exists because a forty-column supplier feed mapped entirely by hand is where
 * an import stops being worth doing.
 */
export function suggestMapping(columns: string[]): TemplateMapping {
  /*
   * Patterns match on a word boundary, not the string start.
   *
   * Supplier columns are `wholesale_price`, `retail_price`, `unit_price` far
   * more often than a bare `price`. Anchoring at the start missed every one of
   * them, which defeats the point: a forty-column feed mapped entirely by hand
   * is where an import stops being worth doing.
   *
   * `(^|[_\s-])` keeps it a prefix of some word, so `price_currency` still
   * matches price and `description` does not match `desc`.
   */
  const patterns: { field: string; match: RegExp; transform?: TransformName }[] = [
    {
      field: 'externalId',
      match: /(^|[_\s-])(g_)?(id|item_?(id|no|number)|external_?id|artikel)/i,
    },
    { field: 'sku', match: /(^|[_\s-])(sku|mpn|article|item_?code|part_?number)/i },
    { field: 'name', match: /(^|[_\s-])(name|title|product_?name)/i },
    {
      field: 'description',
      match: /(^|[_\s-])(description|body|long_?desc)/i,
      transform: 'strip_html',
    },
    { field: 'brandName', match: /(^|[_\s-])(brand|manufacturer|vendor)/i },
    { field: 'categoryPath', match: /(^|[_\s-])(category|categories|product_?type|taxonomy)/i },
    {
      field: 'compareAtPriceCents',
      // Before `priceCents`: `list_price` and `sale_price` both contain
      // "price", and whichever pattern runs first claims the column.
      match: /(^|[_\s-])(compare|was_?price|list_?price|msrp|rrp|sale_?price)/i,
      transform: 'money_to_cents',
    },
    { field: 'priceCents', match: /(^|[_\s-])(price|cost|retail)/i, transform: 'money_to_cents' },
    { field: 'currency', match: /(^|[_\s-])currency/i, transform: 'uppercase' },
    { field: 'quantity', match: /(^|[_\s-])(quantity|qty|stock|inventory)/i, transform: 'integer' },
    { field: 'imageUrls', match: /(^|[_\s-])(image|images|image_?link|image_?url|picture)/i },
    { field: 'barcode', match: /(^|[_\s-])(barcode|gtin|ean|upc)/i },
    { field: 'weightGrams', match: /(^|[_\s-])(weight|shipping_?weight)/i, transform: 'integer' },
    { field: 'material', match: /(^|[_\s-])(material|composition)/i },
    { field: 'color', match: /(^|[_\s-])colou?r/i },
    {
      field: 'isActive',
      match: /(^|[_\s-])(active|enabled|status|availability)/i,
      transform: 'boolean',
    },
  ];

  const mapping: TemplateMapping = {};

  /*
   * One column maps to one field.
   *
   * `sale_price` matching both `compareAtPriceCents` and `priceCents` would
   * silently map the same column twice and leave the real price unmapped —
   * which validates fine and imports every product at its discounted price.
   */
  const claimed = new Set<string>();

  for (const { field, match, transform } of patterns) {
    const column = columns.find(
      (candidate) => !claimed.has(candidate) && match.test(candidate.trim()),
    );

    if (column && !mapping[field]) {
      mapping[field] = transform ? { from: column, transform } : { from: column };
      claimed.add(column);
    }
  }

  return mapping;
}
