import 'server-only';

import { XMLParser } from 'fast-xml-parser';

import type { ImportSourceType } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { checkFeedUrl } from '@/lib/security/uploads';

/**
 * Source adapters: every feed shape reduced to rows of strings.
 *
 * The pipeline is `fetch → parse → normalise → validate → reconcile → persist`,
 * and only the first two steps differ per source. An adapter's whole job is to
 * turn bytes into `Record<string, string>[]`; mapping, validation and
 * reconciliation are shared by everything downstream. That boundary is what
 * stops the fifth supplier arriving as a fifth bespoke script.
 *
 * ## Legal boundary
 *
 * These may only be pointed at feeds we are permitted to ingest: supplier feeds
 * under a distribution agreement, affiliate networks whose terms allow
 * automated retrieval, Google Merchant-format files a partner publishes for us,
 * and our own exports. There is deliberately no HTML parser and no crawler
 * here — scraping a storefront to lift its catalogue is both a terms violation
 * and outside what this system will do.
 */

/** What every adapter returns. Values stay strings until mapping runs. */
export type RawRow = Record<string, string>;

export interface ParseResult {
  rows: RawRow[];
  /** Column names in the order the source presented them, for the mapping UI. */
  columns: string[];
  /** Non-fatal complaints — a skipped malformed line, an unknown element. */
  warnings: string[];
}

/** Guards every ingest: a feed is not allowed to exhaust the server's memory. */
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 250_000;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV, parsed by hand.
 *
 * The entire specification is: fields are comma-separated, a field may be
 * quoted, a quote inside a quoted field is doubled, and a quoted field may
 * contain newlines. That is the state machine below. A dependency here would be
 * a few hundred kilobytes to avoid forty lines, and the forty lines have no
 * supply chain.
 *
 * The delimiter is configurable because European suppliers ship semicolons.
 */
export function parseCsv(text: string, delimiter = ','): ParseResult {
  const warnings: string[] = [];
  const rows: string[][] = [];

  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  // Strip a UTF-8 BOM. Excel writes one, and it silently corrupts the first
  // column name — which is invariably the SKU.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Swallow the second half of CRLF.
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      record.push(field);
      rows.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  // A final line with no trailing newline still counts.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }

  if (inQuotes) warnings.push('The file ended inside a quoted field — the last row may be truncated.');

  const [header, ...body] = rows;
  if (!header) return { rows: [], columns: [], warnings: ['The file is empty.'] };

  const columns = header.map((name, index) => name.trim() || `column_${index + 1}`);

  const parsed: RawRow[] = [];
  for (const [index, line] of body.entries()) {
    // A trailing blank line is not a row.
    if (line.length === 1 && line[0]!.trim() === '') continue;

    if (line.length !== columns.length) {
      warnings.push(`Row ${index + 2} has ${line.length} fields, expected ${columns.length}.`);
    }

    const row: RawRow = {};
    columns.forEach((column, position) => {
      row[column] = (line[position] ?? '').trim();
    });
    parsed.push(row);

    if (parsed.length >= MAX_ROWS) {
      warnings.push(`Stopped at ${MAX_ROWS} rows.`);
      break;
    }
  }

  return { rows: parsed, columns, warnings };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/**
 * `.xlsx`, via ExcelJS.
 *
 * The one format worth a dependency: xlsx is a zip of XML parts with shared
 * string tables, styles and number formats, and dates are serial numbers that
 * need the 1900 leap-year bug applied. Hand-rolling that is a project.
 *
 * ExcelJS rather than SheetJS: the `xlsx` package on npm is the abandoned
 * build — upstream moved distribution to their own CDN and the npm copy still
 * carries unpatched advisories. A maintained package that is slightly larger
 * beats an unmaintained one that is slightly smaller.
 *
 * `.xls` (the pre-2007 binary) is deliberately unsupported — anyone still
 * exporting it can "Save As" once, and a second binary format costs more than
 * it returns.
 */
export async function parseExcel(buffer: ArrayBuffer): Promise<ParseResult> {
  const ExcelJS = await import('exceljs');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], columns: [], warnings: ['The workbook has no sheets.'] };

  const warnings: string[] = [];
  if (workbook.worksheets.length > 1) {
    warnings.push(
      `Only the first sheet ("${sheet.name}") was read; ${workbook.worksheets.length - 1} more were ignored.`,
    );
  }

  const headerRow = sheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, index) => {
    columns[index - 1] = String(cell.value ?? '').trim() || `column_${index}`;
  });

  if (columns.length === 0) {
    return { rows: [], columns: [], warnings: [`Sheet "${sheet.name}" is empty.`] };
  }

  const rows: RawRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= MAX_ROWS) return;

    const out: RawRow = {};
    let hasValue = false;

    columns.forEach((column, index) => {
      const value = row.getCell(index + 1).value;
      const text = cellToString(value);
      out[column] = text;
      if (text) hasValue = true;
    });

    // A row of empty cells is formatting, not data.
    if (hasValue) rows.push(out);
  });

  if (sheet.rowCount - 1 > MAX_ROWS) warnings.push(`Stopped at ${MAX_ROWS} rows.`);

  return { rows, columns, warnings };
}

/**
 * Flattens one cell to text.
 *
 * Excel cells are not strings: a formula cell carries its result beside its
 * source, a hyperlink carries text beside a target, and a date is a real Date.
 * Taking `String(value)` on any of those yields `[object Object]`, which then
 * fails validation with a message that explains nothing.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join('').trim();
    if (cell.result !== undefined) return String(cell.result).trim();
    if (cell.text !== undefined) return String(cell.text).trim();
    return '';
  }
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// XML, including Google Merchant / RSS product feeds
// ---------------------------------------------------------------------------

/**
 * XML feeds, flattened to rows.
 *
 * Covers plain XML, RSS 2.0 with the `g:` namespace (the Google Merchant
 * shape most affiliate networks emit), and Atom. The item path is detected
 * rather than configured, because every supplier nests differently and asking
 * an operator for an XPath is asking them to read the feed first.
 *
 * `fast-xml-parser` rather than a DOM: it streams, it has no native
 * dependencies, and it is already the smallest thing that handles namespaces
 * and entities correctly.
 */
export function parseXml(text: string): ParseResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // `g:price` becomes `g_price`, which is a legal object key and readable in
    // the mapping UI.
    transformTagName: (tag) => tag.replace(':', '_'),
    parseTagValue: false,
    trimValues: true,
  });

  let document: Record<string, unknown>;
  try {
    document = parser.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw errors.badRequest(
      `That XML could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const items = findItems(document);
  if (!items) {
    return { rows: [], columns: [], warnings: ['No repeating element looked like a product list.'] };
  }

  const rows = items.slice(0, MAX_ROWS).map((item) => flatten(item));
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  const warnings: string[] = [];
  if (items.length > MAX_ROWS) warnings.push(`Stopped at ${MAX_ROWS} items.`);

  return { rows, columns, warnings };
}

/**
 * Finds the repeating element that holds the products.
 *
 * Looks for the conventional names first, then falls back to the largest array
 * anywhere in the document — which is, in practice, always the item list.
 */
function findItems(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 8 || node === null || typeof node !== 'object') return null;

  const record = node as Record<string, unknown>;

  for (const name of ['item', 'entry', 'product', 'products', 'Product', 'offer']) {
    const candidate = record[name];
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as Record<string, unknown>[];
    }
    // A feed with exactly one product yields an object, not an array.
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return [candidate as Record<string, unknown>];
    }
  }

  let best: Record<string, unknown>[] | null = null;
  for (const value of Object.values(record)) {
    const found = findItems(value, depth + 1);
    if (found && (!best || found.length > best.length)) best = found;
  }

  return best;
}

/** Collapses nested XML into flat `parent_child` keys. */
function flatten(node: unknown, prefix = '', depth = 0): RawRow {
  const out: RawRow = {};
  if (depth > 6 || node === null || node === undefined) return out;

  if (typeof node !== 'object') {
    if (prefix) out[prefix] = String(node);
    return out;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const name = prefix ? `${prefix}_${key}` : key;

    if (Array.isArray(value)) {
      // Repeated elements (extra images, several categories) join with a pipe,
      // which the mapper splits back out.
      out[name] = value.map((entry) => (typeof entry === 'object' ? '' : String(entry))).filter(Boolean).join('|');
    } else if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value, name, depth + 1));
    } else if (value !== undefined) {
      out[name] = String(value);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** JSON feeds: an array, or an object with the array under a common key. */
export function parseJson(text: string): ParseResult {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw errors.badRequest(
      `That JSON could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  let items: unknown[] | null = Array.isArray(document) ? document : null;

  if (!items && document && typeof document === 'object') {
    for (const key of ['products', 'items', 'data', 'results', 'entries', 'offers']) {
      const candidate = (document as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        items = candidate;
        break;
      }
    }
  }

  if (!items) {
    return { rows: [], columns: [], warnings: ['No product array was found in that JSON.'] };
  }

  const rows = items.slice(0, MAX_ROWS).map((item) => flatten(item));
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  const warnings: string[] = [];
  if (items.length > MAX_ROWS) warnings.push(`Stopped at ${MAX_ROWS} items.`);

  return { rows, columns, warnings };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Retrieves a remote feed.
 *
 * HTTPS only, size-capped, and timed out. A feed URL is operator-supplied
 * rather than user-supplied, but it is still a server-side request to an
 * address someone typed, so the same rules apply as anywhere else: no plain
 * HTTP, no unbounded body, no waiting forever.
 */
export async function fetchFeed(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ text: string; buffer: ArrayBuffer; contentType: string }> {
  /*
   * Validated in one place, because this is the only place a feed is fetched.
   *
   * A URL pointing at 169.254.169.254 reads cloud instance credentials and one
   * pointing at localhost reaches the database. Operator input is not customer
   * input, but an admin account can be compromised and the blast radius of
   * that particular mistake is the whole environment.
   */
  const verdict = checkFeedUrl(url);
  if (!verdict.ok) throw errors.badRequest(verdict.reason ?? 'That feed URL is not allowed.');

  const response = await fetch(url, {
    headers: {
      // Identifying the client is basic courtesy to a supplier reading their
      // logs, and it is what lets them allow-list us.
      'User-Agent': 'GoodTimeImporter/1.0 (+https://goodtime.example/import)',
      Accept: 'text/csv, application/json, application/xml, text/xml, */*',
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw errors.badRequest(`The feed returned ${response.status} ${response.statusText}.`);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) {
    throw errors.badRequest(`That feed is ${Math.round(declared / 1e6)}MB; the limit is 64MB.`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    // Checked again after reading: `content-length` is a claim, not a promise.
    throw errors.badRequest('That feed exceeded 64MB while downloading.');
  }

  return {
    text: new TextDecoder('utf-8').decode(buffer),
    buffer,
    contentType: response.headers.get('content-type') ?? '',
  };
}

/** Picks a parser from the declared source type, falling back to sniffing. */
export async function parseSource(
  sourceType: ImportSourceType,
  input: { text?: string; buffer?: ArrayBuffer; delimiter?: string },
): Promise<ParseResult> {
  const text = input.text ?? '';

  switch (sourceType) {
    case 'CSV':
      return parseCsv(text, input.delimiter ?? detectDelimiter(text));
    case 'EXCEL':
      if (!input.buffer) throw errors.badRequest('An Excel import needs the original file.');
      return parseExcel(input.buffer);
    case 'XML':
    case 'GOOGLE_MERCHANT':
      return parseXml(text);
    case 'JSON':
    case 'SUPPLIER_API':
    case 'AFFILIATE_FEED':
      // These arrive as JSON far more often than not; XML is the fallback.
      return text.trimStart().startsWith('<') ? parseXml(text) : parseJson(text);
    default:
      throw errors.badRequest(`No adapter for source type ${sourceType}.`);
  }
}

/**
 * Guesses the delimiter from the header line.
 *
 * Counting candidates on the first line only: a comma inside a quoted product
 * description would otherwise outvote the real separator.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 4000).split(/\r?\n/)[0] ?? '';

  const counts = [',', ';', '\t', '|'].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));

  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.candidate : ',';
}
