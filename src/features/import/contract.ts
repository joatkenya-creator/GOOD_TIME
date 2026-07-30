import { z } from 'zod';

import type { ImportSourceType } from '@/generated/prisma/enums';

/**
 * Catalogue import architecture.
 *
 * Nothing is implemented here on purpose — this file defines the shape that every
 * future adapter must satisfy, so CSV, XML, JSON, a supplier REST API and an
 * affiliate feed all reduce to the same pipeline:
 *
 *     fetch -> parse -> normalise -> validate -> reconcile -> persist
 *
 * Only the first three steps differ per source. Keeping them behind one interface
 * is what stops the fifth supplier from arriving as a fifth bespoke script.
 *
 * ## Legal boundary
 *
 * Adapters may only be pointed at feeds we are contractually or licensally
 * permitted to ingest: supplier feeds under a distribution agreement, affiliate
 * networks whose terms allow automated retrieval, and our own exports. Scraping a
 * competitor's storefront is out of scope and must not be built here.
 *
 * ## Normalised row
 *
 * The single shape every adapter produces. Prices are cents, never dollars —
 * a supplier feed that says "19.99" must be converted at the adapter boundary,
 * not somewhere downstream where a float has already lost a penny.
 */
export const importedProductSchema = z.object({
  /** Supplier's own identifier. Used to match on re-import; must be stable. */
  externalId: z.string().min(1).max(128),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  description: z.string().max(20_000).optional(),
  brandName: z.string().max(120).optional(),
  categoryPath: z.array(z.string().min(1)).max(6).optional(),
  priceCents: z.number().int().min(0),
  compareAtPriceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).default('USD'),
  quantity: z.number().int().min(0).optional(),
  barcode: z.string().max(64).optional(),
  weightGrams: z.number().int().min(0).optional(),
  imageUrls: z.array(z.url()).max(20).default([]),
  attributes: z.record(z.string(), z.string()).optional(),
  /** Variant axes, e.g. `{ Colour: 'Rose', Size: 'Large' }`. */
  options: z.record(z.string(), z.string()).optional(),
});

export type ImportedProduct = z.infer<typeof importedProductSchema>;

export interface ImportContext {
  jobId: string;
  /** Adapter-specific settings from `ImportJob.config`. */
  config: Record<string, unknown>;
  /** Called per batch so a long-running job reports progress. */
  onProgress: (processed: number, failed: number) => Promise<void>;
}

export interface ImportAdapter {
  readonly sourceType: ImportSourceType;
  readonly name: string;

  /** Rejects malformed configuration before the job is queued. */
  validateConfig: (config: unknown) => Promise<Record<string, unknown>>;

  /**
   * Yields rows lazily.
   *
   * An async generator rather than a returned array: a 200MB supplier CSV must
   * stream, because materialising 100k rows in a serverless function's memory is
   * how the import dies at 80%.
   */
  read: (context: ImportContext) => AsyncGenerator<unknown, void, undefined>;

  /** Maps one raw row onto the normalised shape. The only source-aware step. */
  normalise: (row: unknown) => ImportedProduct | null;
}

/**
 * How an incoming row relates to what we already hold.
 *
 * Reconciliation is deliberately explicit: a re-import that silently overwrote
 * hand-written merchandising copy would be worse than one that failed loudly.
 */
export type ReconcileAction =
  | { kind: 'create' }
  | { kind: 'update'; productId: string; fields: (keyof ImportedProduct)[] }
  | { kind: 'skip'; reason: string };

export interface ImportPolicy {
  /** Fields the import owns. Everything else is preserved on update. */
  managedFields: (keyof ImportedProduct)[];
  /** Products created by an import start as DRAFT for human review. */
  publishOnCreate: boolean;
  /** Stop the job once this many rows fail; a broken feed should not half-import. */
  maxFailures: number;
}

export const DEFAULT_IMPORT_POLICY: ImportPolicy = {
  managedFields: ['priceCents', 'compareAtPriceCents', 'quantity', 'barcode', 'weightGrams'],
  publishOnCreate: false,
  maxFailures: 100,
};

/**
 * Adapter registry.
 *
 * Empty until phase 6. Adding a source means writing one adapter and registering
 * it here; the runner, job tracking and reconciliation stay untouched.
 */
export const importAdapters = new Map<ImportSourceType, ImportAdapter>();
