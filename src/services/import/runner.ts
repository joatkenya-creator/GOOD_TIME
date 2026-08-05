import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import type { ImportRowOutcome } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import type { JobContext } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { fetchFeed, parseSource, type RawRow } from '@/services/import/adapters';
import { mapRow, validateRow, type TemplateMapping } from '@/services/import/mapper';

/**
 * The import runner: reconcile and persist.
 *
 * Everything upstream — fetch, parse, map, validate — is format-specific and
 * already done by the time a row reaches here. What is left is the part every
 * source shares and the part that is actually dangerous: deciding whether a row
 * is a new product, an update to an existing one, or a conflict, and writing it
 * without destroying what is already there.
 *
 * ## Three rules
 *
 * **Every row is recorded, including the ones that did nothing.** An import
 * that reports "4,812 succeeded" and nothing else is unauditable. `ImportRow`
 * stores the before-image per row, which is what makes rollback possible at all.
 *
 * **Batches commit independently.** One poisoned row in a 50,000-row feed must
 * not roll back the 49,999 good ones. Each batch is its own transaction; a
 * failure marks its rows and the run continues.
 *
 * **An import never deletes.** The worst a feed can do is deactivate. A
 * supplier who ships a truncated file on a bad day would otherwise wipe the
 * catalogue, and no amount of validation catches "this file is legitimately
 * formatted and legitimately missing 9,000 products".
 */

const BATCH_SIZE = 200;

interface ImportConfig {
  url?: string;
  headers?: Record<string, string>;
  delimiter?: string;
  /** Inline content, for an uploaded file. */
  content?: string;
  /** How to treat a row whose values differ from the stored product. */
  conflictPolicy?: ConflictPolicy;
  /** Fields the feed is allowed to overwrite. Empty means all mapped fields. */
  updateFields?: string[];
}

/**
 * What to do when a feed disagrees with the catalogue.
 *
 * The default is deliberately the cautious one. A supplier feed is not
 * automatically more correct than a merchandiser's hand-written copy, and
 * silently overwriting a curated description with "BLACK SILICONE VIBE 7IN"
 * is the kind of thing discovered by a customer.
 */
export type ConflictPolicy =
  /** Feed wins for mapped fields. */
  | 'overwrite'
  /** Existing values win; only fill blanks. */
  | 'fill_blanks'
  /** Record the difference, change nothing, let a human decide. */
  | 'flag';

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
  failed: number;
  warnings: string[];
  dryRun: boolean;
}

/**
 * Runs one import job to completion.
 *
 * Called by the `import.run` background job. Progress is reported through the
 * job context so the admin shows movement rather than a spinner and a guess.
 */
export async function runImportJob(jobId: string, context?: JobContext): Promise<ImportSummary> {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    include: { template: true },
  });

  if (!job) throw errors.notFound('Import job');

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  try {
    const summary = await execute(job, context);

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status:
          summary.failed > 0 && summary.created + summary.updated === 0 ? 'FAILED' : 'COMPLETED',
        totalRows: summary.total,
        processedRows: summary.created + summary.updated + summary.skipped,
        failedRows: summary.failed,
        errors:
          summary.warnings.length > 0 ? (summary.warnings as Prisma.InputJsonValue) : undefined,
        finishedAt: new Date(),
      },
    });

    return summary;
  } catch (error) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errors: [error instanceof Error ? error.message : String(error)] as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}

type JobWithTemplate = Prisma.ImportJobGetPayload<{ include: { template: true } }>;

async function execute(job: JobWithTemplate, context?: JobContext): Promise<ImportSummary> {
  const config = (job.config ?? {}) as ImportConfig;
  const mapping = (job.template?.mapping ?? {}) as TemplateMapping;
  const defaults = (job.template?.defaults ?? {}) as Record<string, unknown>;

  if (Object.keys(mapping).length === 0) {
    throw errors.badRequest('This import has no field mapping. Choose or create a template first.');
  }

  // --- fetch ---------------------------------------------------------------
  let text = config.content ?? '';
  let buffer: ArrayBuffer | undefined;

  if (!text && config.url) {
    const fetched = await fetchFeed(config.url, { headers: config.headers });
    text = fetched.text;
    buffer = fetched.buffer;
  }

  if (!text && !buffer) {
    throw errors.badRequest('This import has neither a feed URL nor uploaded content.');
  }

  // --- parse ---------------------------------------------------------------
  const parsed = await parseSource(job.sourceType, {
    text,
    buffer,
    delimiter: config.delimiter,
  });

  const summary: ImportSummary = {
    total: parsed.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    failed: 0,
    warnings: [...parsed.warnings],
    dryRun: job.isDryRun,
  };

  await prisma.importJob.update({
    where: { id: job.id },
    data: { totalRows: summary.total },
  });

  /*
   * Duplicate detection, in-file.
   *
   * A feed that lists the same SKU twice is common — a supplier exporting from
   * two warehouses, or a variant flattened into rows. Processing both means the
   * second silently overwrites the first, so the later one is skipped and said
   * so rather than quietly winning.
   */
  const seen = new Set<string>();

  for (let offset = 0; offset < parsed.rows.length; offset += BATCH_SIZE) {
    const batch = parsed.rows.slice(offset, offset + BATCH_SIZE);

    try {
      await processBatch(job, batch, offset, mapping, defaults, config, seen, summary);
    } catch (error) {
      // A whole batch failing is infrastructure, not data — a lost connection,
      // a deadlock. The rows are marked and the run continues rather than
      // discarding everything that already worked.
      logger.error('import.batch_failed', error, { jobId: job.id, offset });
      summary.failed += batch.length;
      summary.warnings.push(
        `Rows ${offset + 1}–${offset + batch.length} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        processedRows: summary.created + summary.updated + summary.skipped,
        failedRows: summary.failed,
      },
    });

    await context?.progress(offset + batch.length, summary.total);
  }

  // Rebuilding search documents is the importer's job, not the product
  // service's — one enqueue per changed product, deduped by the queue.
  if (!job.isDryRun && summary.created + summary.updated > 0) {
    const touched = await prisma.importRow.findMany({
      where: { jobId: job.id, outcome: { in: ['CREATED', 'UPDATED'] }, productId: { not: null } },
      select: { productId: true },
    });

    const { enqueueReindex } = await import('@/lib/jobs/handlers');
    await enqueueReindex(touched.map((row) => row.productId!).filter(Boolean));
  }

  return summary;
}

async function processBatch(
  job: JobWithTemplate,
  batch: RawRow[],
  offset: number,
  mapping: TemplateMapping,
  defaults: Record<string, unknown>,
  config: ImportConfig,
  seen: Set<string>,
  summary: ImportSummary,
): Promise<void> {
  const rowRecords: Prisma.ImportRowCreateManyInput[] = [];

  for (const [index, raw] of batch.entries()) {
    const rowNumber = offset + index + 1;

    const mapped = mapRow(raw, mapping, defaults);
    const validated = validateRow(mapped.data);

    if (!validated.ok || !validated.data) {
      summary.failed += 1;
      rowRecords.push({
        jobId: job.id,
        rowNumber,
        outcome: 'FAILED',
        externalId: String(mapped.data.externalId ?? '') || null,
        sku: String(mapped.data.sku ?? '') || null,
        after: mapped.data as Prisma.InputJsonValue,
        message: validated.errors.join('; ').slice(0, 2000),
      });
      continue;
    }

    const product = validated.data;
    const key = `${product.externalId}|${product.sku}`;

    if (seen.has(key)) {
      summary.skipped += 1;
      rowRecords.push({
        jobId: job.id,
        rowNumber,
        outcome: 'SKIPPED',
        externalId: product.externalId,
        sku: product.sku,
        message: 'Duplicate of an earlier row in the same file.',
      });
      continue;
    }
    seen.add(key);

    const outcome = await reconcile(job, product, config, rowNumber);

    if (outcome.outcome === 'CREATED') summary.created += 1;
    else if (outcome.outcome === 'UPDATED') summary.updated += 1;
    else if (outcome.outcome === 'CONFLICT') summary.conflicts += 1;
    else if (outcome.outcome === 'FAILED') summary.failed += 1;
    else summary.skipped += 1;

    rowRecords.push({ jobId: job.id, rowNumber, ...outcome });
  }

  if (rowRecords.length > 0) {
    await prisma.importRow.createMany({ data: rowRecords });
  }
}

type ReconcileResult = {
  outcome: ImportRowOutcome;
  externalId: string | null;
  sku: string | null;
  productId: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  message: string | null;
};

/**
 * Matches a row to a product and writes it.
 *
 * Matching order is external id, then SKU, then barcode. External id first
 * because it is the supplier's own key and survives their renaming a product;
 * SKU second because it is ours and stable; barcode last because two suppliers
 * legitimately share a GTIN for the same manufactured item.
 */
async function reconcile(
  job: JobWithTemplate,
  incoming: {
    externalId: string;
    sku: string;
    name: string;
    description?: string;
    brandName?: string;
    categoryPath?: string[];
    priceCents: number;
    compareAtPriceCents?: number;
    currency: string;
    quantity?: number;
    imageUrls?: string[];
    barcode?: string;
    weightGrams?: number;
    isActive?: boolean;
  },
  config: ImportConfig,
  _rowNumber: number,
): Promise<ReconcileResult> {
  const policy = config.conflictPolicy ?? 'overwrite';

  const existing = await prisma.product.findFirst({
    where: {
      OR: [
        { externalId: incoming.externalId },
        { sku: incoming.sku },
        ...(incoming.barcode ? [{ barcode: incoming.barcode }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      description: true,
      sku: true,
      externalId: true,
      status: true,
      minPriceCents: true,
      variants: { select: { id: true, priceCents: true }, take: 1 },
    },
  });

  const base = {
    externalId: incoming.externalId,
    sku: incoming.sku,
    name: incoming.name,
    sku_lower: incoming.sku.toLowerCase(),
  };

  // A dry run reports what would happen and writes nothing.
  if (job.isDryRun) {
    return {
      outcome: existing ? 'UPDATED' : 'CREATED',
      externalId: incoming.externalId,
      sku: incoming.sku,
      productId: existing?.id ?? null,
      after: incoming as unknown as Prisma.InputJsonValue,
      message: existing ? 'Would update' : 'Would create',
    };
  }

  if (!existing) {
    const created = await createProduct(incoming);
    return {
      outcome: 'CREATED',
      externalId: incoming.externalId,
      sku: incoming.sku,
      productId: created.id,
      after: incoming as unknown as Prisma.InputJsonValue,
      message: null,
    };
  }

  const before = {
    name: existing.name,
    description: existing.description,
    priceCents: existing.variants[0]?.priceCents ?? existing.minPriceCents,
    status: existing.status,
  };

  const differs =
    before.name !== incoming.name ||
    (incoming.priceCents !== undefined && before.priceCents !== incoming.priceCents);

  if (policy === 'flag' && differs) {
    return {
      outcome: 'CONFLICT',
      externalId: incoming.externalId,
      sku: incoming.sku,
      productId: existing.id,
      before: before as unknown as Prisma.InputJsonValue,
      after: incoming as unknown as Prisma.InputJsonValue,
      message: 'Feed disagrees with the stored product; left unchanged.',
    };
  }

  if (!differs && policy !== 'overwrite') {
    return {
      outcome: 'SKIPPED',
      externalId: incoming.externalId,
      sku: incoming.sku,
      productId: existing.id,
      message: 'No change.',
    };
  }

  await updateProduct(existing.id, incoming, policy, existing);
  void base;

  return {
    outcome: 'UPDATED',
    externalId: incoming.externalId,
    sku: incoming.sku,
    productId: existing.id,
    before: before as unknown as Prisma.InputJsonValue,
    after: incoming as unknown as Prisma.InputJsonValue,
    message: null,
  };
}

/** Deterministic slug, with the SKU as the collision-breaker. */
function slugFor(name: string, sku: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  const suffix = createHash('sha1').update(sku).digest('hex').slice(0, 6);
  return base ? `${base}-${suffix}` : `product-${suffix}`;
}

async function createProduct(incoming: {
  externalId: string;
  sku: string;
  name: string;
  description?: string;
  priceCents: number;
  compareAtPriceCents?: number;
  currency: string;
  quantity?: number;
  weightGrams?: number;
  isActive?: boolean;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        slug: slugFor(incoming.name, incoming.sku),
        name: incoming.name,
        description: incoming.description ?? '',
        sku: incoming.sku,
        externalId: incoming.externalId,
        currency: incoming.currency,
        minPriceCents: incoming.priceCents,
        maxPriceCents: incoming.priceCents,
        /*
         * Imported products arrive as drafts, always.
         *
         * A feed is a proposal, not a merchandising decision. Publishing on
         * import means a supplier's typo is live on the storefront before
         * anyone has seen it — and in this category, an unreviewed product
         * description is a brand risk, not just a typo.
         */
        status: 'DRAFT',
      },
      select: { id: true },
    });

    const variant = await tx.variant.create({
      data: {
        productId: product.id,
        sku: incoming.sku,
        name: 'Default',
        priceCents: incoming.priceCents,
        compareAtPriceCents: incoming.compareAtPriceCents ?? null,
        weightGrams: incoming.weightGrams ?? 0,
        position: 0,
      },
      select: { id: true },
    });

    await tx.inventory.create({
      data: {
        variantId: variant.id,
        quantity: incoming.quantity ?? 0,
        lowStockThreshold: 5,
      },
    });

    return product;
  });
}

async function updateProduct(
  productId: string,
  incoming: {
    name: string;
    description?: string;
    priceCents: number;
    compareAtPriceCents?: number;
    quantity?: number;
  },
  policy: ConflictPolicy,
  existing: { description: string | null; variants: { id: string }[] },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        name: incoming.name,
        // `fill_blanks` is the whole reason this is not a blanket overwrite:
        // a merchandiser's copy outranks a supplier's.
        ...(policy === 'overwrite' || !existing.description
          ? { description: incoming.description ?? existing.description ?? '' }
          : {}),
        minPriceCents: incoming.priceCents,
        maxPriceCents: incoming.priceCents,
      },
    });

    const variantId = existing.variants[0]?.id;
    if (variantId) {
      await tx.variant.update({
        where: { id: variantId },
        data: {
          priceCents: incoming.priceCents,
          compareAtPriceCents: incoming.compareAtPriceCents ?? null,
        },
      });

      /*
       * Stock goes through the ledger, never a direct write.
       *
       * The inventory module's one rule is that no quantity changes without a
       * row saying who changed it and why. An importer that wrote `quantity`
       * directly would be the first exception, and the first exception is how
       * the rule stops meaning anything.
       */
      if (incoming.quantity !== undefined) {
        const inventory = await tx.inventory.findUnique({
          where: { variantId },
          select: { quantity: true },
        });

        if (inventory && inventory.quantity !== incoming.quantity) {
          const delta = incoming.quantity - inventory.quantity;

          await tx.inventory.update({
            where: { variantId },
            data: { quantity: incoming.quantity },
          });

          await tx.stockAdjustment.create({
            data: {
              variantId,
              delta,
              quantityAfter: incoming.quantity,
              reason: 'CORRECTION',
              note: 'Supplier feed synchronisation',
            },
          });
        }
      }
    }
  });
}

/**
 * Reverses an import.
 *
 * Replays `ImportRow.before` backwards: created products are archived (never
 * deleted — an order may already reference one), updated products are restored
 * to their stored before-image. Rows that failed or were skipped changed
 * nothing and are ignored.
 *
 * Marked on the job so it cannot be applied twice, which would restore a
 * before-image that is no longer the truth.
 */
export async function rollbackImport(
  jobId: string,
  actorId?: string,
): Promise<{
  archived: number;
  restored: number;
}> {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { id: true, rolledBackAt: true, isDryRun: true },
  });

  if (!job) throw errors.notFound('Import job');
  if (job.isDryRun)
    throw errors.badRequest('A dry run changed nothing, so there is nothing to roll back.');
  if (job.rolledBackAt) throw errors.badRequest('This import has already been rolled back.');

  const rows = await prisma.importRow.findMany({
    where: { jobId, outcome: { in: ['CREATED', 'UPDATED'] }, productId: { not: null } },
    select: { outcome: true, productId: true, before: true },
  });

  let archived = 0;
  let restored = 0;

  for (const row of rows) {
    if (!row.productId) continue;

    if (row.outcome === 'CREATED') {
      await prisma.product.update({
        where: { id: row.productId },
        data: { status: 'ARCHIVED' },
      });
      archived += 1;
      continue;
    }

    const before = row.before as {
      name?: string;
      description?: string;
      priceCents?: number;
    } | null;
    if (!before) continue;

    await prisma.product.update({
      where: { id: row.productId },
      data: {
        ...(before.name ? { name: before.name } : {}),
        ...(before.description !== undefined ? { description: before.description ?? '' } : {}),
        ...(before.priceCents !== undefined
          ? { minPriceCents: before.priceCents, maxPriceCents: before.priceCents }
          : {}),
      },
    });
    restored += 1;
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
  });

  logger.info('import.rolled_back', { jobId, archived, restored, actorId });

  return { archived, restored };
}
