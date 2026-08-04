import 'server-only';

import { errors } from '@/lib/api/errors';

/**
 * Upload and feed-URL validation.
 *
 * ## Why the extension is not enough
 *
 * A file called `products.csv` can contain anything. The browser's reported
 * MIME type is attacker-controlled. So this reads the actual first bytes and
 * checks them against what the extension claims — a mismatch is the signature
 * of someone trying to get a payload past a filter, and it is also, far more
 * often, someone who renamed an `.xlsx` to `.csv` and cannot work out why the
 * import fails.
 *
 * ## The three attacks this actually stops
 *
 * **Zip bombs.** An `.xlsx` is a zip archive. A 2KB file can expand to
 * gigabytes and take the process with it. The compression ratio is checked
 * before the archive is opened.
 *
 * **Formula injection.** A CSV cell beginning `=`, `+`, `-` or `@` is executed
 * by Excel when a merchant opens the exported file. That makes *our* export a
 * delivery mechanism for a payload someone put in *their* feed, which is a
 * supply-chain attack with the shop as the courier.
 *
 * **SSRF.** A feed URL pointing at `169.254.169.254` reads cloud instance
 * credentials; one pointing at `localhost` reaches the database. Operator
 * input is not user input, but it is still input.
 */

/** Magic bytes, keyed by what the file claims to be. */
const SIGNATURES: Record<string, { bytes: number[]; label: string }[]> = {
  xlsx: [{ bytes: [0x50, 0x4b, 0x03, 0x04], label: 'zip (xlsx)' }],
  zip: [{ bytes: [0x50, 0x4b, 0x03, 0x04], label: 'zip' }],
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47], label: 'png' }],
  jpg: [{ bytes: [0xff, 0xd8, 0xff], label: 'jpeg' }],
  jpeg: [{ bytes: [0xff, 0xd8, 0xff], label: 'jpeg' }],
  gif: [{ bytes: [0x47, 0x49, 0x46, 0x38], label: 'gif' }],
  webp: [{ bytes: [0x52, 0x49, 0x46, 0x46], label: 'riff (webp)' }],
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46], label: 'pdf' }],
};

/** Extensions the import platform accepts at all. */
export const ALLOWED_IMPORT_EXTENSIONS = ['csv', 'tsv', 'txt', 'xlsx', 'xml', 'json'] as const;

export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export interface UploadCheck {
  ok: boolean;
  extension: string;
  detectedType: string | null;
  reason?: string;
}

function extensionOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

/**
 * Validates an uploaded import file.
 *
 * Text formats are not signature-checked — CSV, XML and JSON have no magic
 * bytes, and inventing a heuristic for them would reject legitimate files far
 * more often than it caught anything. They are checked for shape instead.
 */
export function checkUpload(filename: string, buffer: ArrayBuffer): UploadCheck {
  const extension = extensionOf(filename);
  const bytes = new Uint8Array(buffer.slice(0, 16));

  if (!ALLOWED_IMPORT_EXTENSIONS.includes(extension as (typeof ALLOWED_IMPORT_EXTENSIONS)[number])) {
    return {
      ok: false,
      extension,
      detectedType: null,
      reason: `Files of type .${extension} are not accepted. Use ${ALLOWED_IMPORT_EXTENSIONS.join(', ')}.`,
    };
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      extension,
      detectedType: null,
      reason: `That file is ${Math.round(buffer.byteLength / 1e6)}MB; the limit is 64MB.`,
    };
  }

  if (buffer.byteLength === 0) {
    return { ok: false, extension, detectedType: null, reason: 'That file is empty.' };
  }

  // Anything that looks like an executable is refused whatever it is called.
  const dangerous: { bytes: number[]; label: string }[] = [
    { bytes: [0x4d, 0x5a], label: 'a Windows executable' },
    { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'a Linux executable' },
    { bytes: [0xca, 0xfe, 0xba, 0xbe], label: 'a Mach-O or Java binary' },
    { bytes: [0x23, 0x21], label: 'a shell script' },
  ];

  for (const candidate of dangerous) {
    if (startsWith(bytes, candidate.bytes)) {
      return {
        ok: false,
        extension,
        detectedType: candidate.label,
        reason: `That file is ${candidate.label}, not a ${extension.toUpperCase()} feed.`,
      };
    }
  }

  const expected = SIGNATURES[extension];

  if (expected) {
    const matched = expected.find((signature) => startsWith(bytes, signature.bytes));
    if (!matched) {
      return {
        ok: false,
        extension,
        detectedType: null,
        reason: `That file does not look like a ${extension.toUpperCase()} file inside.`,
      };
    }
    return { ok: true, extension, detectedType: matched.label };
  }

  // Text formats: reject anything with NUL bytes, which no text feed contains
  // and every binary does.
  if (bytes.includes(0)) {
    return {
      ok: false,
      extension,
      detectedType: 'binary',
      reason: `A .${extension} file should be text, and this one is binary.`,
    };
  }

  return { ok: true, extension, detectedType: 'text' };
}

/**
 * Refuses an archive whose compression ratio is implausible.
 *
 * A legitimate spreadsheet compresses maybe 10:1. A zip bomb is 1000:1 or
 * worse, and the point of checking before extraction is that after extraction
 * is too late — the memory is already gone.
 */
export function checkCompressionRatio(compressedBytes: number, declaredUncompressed: number): void {
  if (compressedBytes === 0) return;

  const ratio = declaredUncompressed / compressedBytes;

  if (ratio > 200) {
    throw errors.badRequest(
      `That archive expands ${Math.round(ratio)}× its size, which is not a normal spreadsheet.`,
    );
  }
}

/**
 * Neutralises a value before it is written into a CSV export.
 *
 * A cell beginning `=`, `+`, `-` or `@` is a formula to Excel and to Sheets.
 * Supplier data flows into our exports, so without this a hostile feed can
 * plant `=cmd|'/c calc'!A1` in a product name and have it execute on the
 * merchant's machine when they open the report. Prefixing a single quote is
 * the OWASP-recommended fix and is invisible in the opened sheet.
 */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Validates a feed URL before anything fetches it.
 *
 * Operator-supplied rather than customer-supplied, which lowers the risk but
 * does not remove it: an admin account can be compromised, and a URL that
 * makes the server read its own metadata endpoint is a credential leak
 * regardless of who typed it.
 */
export function checkFeedUrl(raw: string): { ok: boolean; reason?: string } {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Feed URLs must use https.' };
  }

  const host = url.hostname.toLowerCase();

  // Loopback and link-local, including the cloud metadata address, which is
  // the single most valuable SSRF target on any hosted platform.
  const blocked = [
    /^localhost$/,
    /^127\./,
    /^0\./,
    /^169\.254\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^\[?::1\]?$/,
    /^\[?fc00:/i,
    /^\[?fe80:/i,
    /\.local$/,
    /\.internal$/,
  ];

  if (blocked.some((pattern) => pattern.test(host))) {
    return {
      ok: false,
      reason: 'That address is on a private or loopback network, which a feed URL must not be.',
    };
  }

  return { ok: true };
}

/**
 * Verifies an inbound webhook signature.
 *
 * Timing-safe comparison, because a plain `===` on a signature leaks how much
 * of a guess was correct through how long the comparison ran. That is a real
 * attack on a long-lived shared secret, and the fix costs nothing.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const { createHmac, timingSafeEqual } = await import('node:crypto');

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const provided = signature.replace(/^sha256=/, '');

  // `timingSafeEqual` throws on a length mismatch, which is itself an answer,
  // so the lengths are compared first and a mismatch fails without throwing.
  if (expected.length !== provided.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}
