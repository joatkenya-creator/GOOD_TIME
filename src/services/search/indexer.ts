import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { JobContext } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Search indexing.
 *
 * `ProductSearchDocument` is a denormalised row per product: title, brand,
 * category path and a blob of everything else worth matching. Postgres full
 * text runs against it, and an external engine — Meilisearch, OpenSearch — is
 * fed from exactly the same document.
 *
 * That is the whole reason the document exists as a table rather than as a
 * query across six joins. Swapping the engine becomes "read these rows and
 * push them somewhere else", not "reimplement the query in another language".
 */

/** Everything that should influence a match, in one string. */
function buildContent(product: {
  name: string;
  subtitle: string | null;
  shortDescription: string | null;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  brand: { name: string } | null;
  primaryCategory: { name: string; path: string } | null;
  categories: { category: { name: string } }[];
  tags: { name: string }[];
  productAttributes: { value: string; definition: { label: string } }[];
  variants: { sku: string; name: string }[];
}): string {
  const parts = [
    product.name,
    product.subtitle,
    product.shortDescription,
    // Stripped: a description full of markup matches on "strong" and "href".
    product.description?.replace(/<[^>]*>/g, ' ') ?? '',
    product.sku,
    product.barcode,
    product.brand?.name,
    product.primaryCategory?.name,
    ...product.categories.map((entry) => entry.category.name),
    ...product.tags.map((tag) => tag.name),
    ...product.productAttributes.map(
      (attribute) => `${attribute.definition.label} ${attribute.value}`,
    ),
    ...product.variants.map((variant) => `${variant.name} ${variant.sku}`),
  ];

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 20_000);
}

/** Short, high-signal terms for autocomplete and typo matching. */
function buildKeywords(product: {
  name: string;
  brand: { name: string } | null;
  tags: { name: string }[];
  primaryCategory: { name: string } | null;
}): string[] {
  const words = [
    ...product.name.toLowerCase().split(/\W+/),
    ...(product.brand?.name.toLowerCase().split(/\W+/) ?? []),
    ...(product.primaryCategory?.name.toLowerCase().split(/\W+/) ?? []),
    ...product.tags.map((tag) => tag.name.toLowerCase()),
  ];

  return [...new Set(words.filter((word) => word.length > 2))].slice(0, 40);
}

const INDEX_SELECT = {
  id: true,
  name: true,
  subtitle: true,
  shortDescription: true,
  description: true,
  sku: true,
  barcode: true,
  status: true,
  deletedAt: true,
  brand: { select: { name: true } },
  primaryCategory: { select: { name: true, path: true } },
  categories: { select: { category: { select: { name: true } } } },
  tags: { select: { name: true } },
  productAttributes: { select: { value: true, definition: { select: { label: true } } } },
  variants: { select: { sku: true, name: true } },
} satisfies Prisma.ProductSelect;

/**
 * Rebuilds one product's document.
 *
 * Idempotent by construction — it derives the document from the product rather
 * than mutating it, so running twice writes the same row. That matters because
 * the queue may deliver a job more than once after a worker crash.
 */
export async function indexProduct(
  productId: string,
): Promise<{ indexed: boolean; reason?: string }> {
  if (!productId) return { indexed: false, reason: 'no id' };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: INDEX_SELECT,
  });

  if (!product) {
    // Deleted between enqueue and run. Remove the document rather than fail:
    // a stale search result is worse than a missing one.
    await prisma.productSearchDocument.deleteMany({ where: { productId } });
    return { indexed: false, reason: 'product gone' };
  }

  // Drafts and archived products must not be findable on the storefront.
  if (product.status !== 'ACTIVE' || product.deletedAt) {
    await prisma.productSearchDocument.deleteMany({ where: { productId } });
    return { indexed: false, reason: `status ${product.status}` };
  }

  const document = {
    title: product.name,
    brandName: product.brand?.name ?? null,
    categoryPath: product.primaryCategory?.path ?? null,
    keywords: buildKeywords(product),
    content: buildContent(product),
  };

  await prisma.productSearchDocument.upsert({
    where: { productId },
    update: document,
    create: { productId, ...document },
  });

  return { indexed: true };
}

/**
 * Rebuilds every document.
 *
 * Paged by cursor rather than offset: `OFFSET 90000` makes Postgres walk ninety
 * thousand rows to skip them, so a full reindex of a large catalogue gets
 * quadratically slower as it proceeds. A cursor stays flat.
 */
export async function reindexAll(context?: JobContext): Promise<{
  indexed: number;
  removed: number;
  elapsedMs: number;
}> {
  const started = Date.now();
  const pageSize = 200;

  let cursor: string | undefined;
  let indexed = 0;
  let removed = 0;

  const total = await prisma.product.count({ where: { status: 'ACTIVE', deletedAt: null } });

  for (;;) {
    const page = await prisma.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: INDEX_SELECT,
    });

    if (page.length === 0) break;

    for (const product of page) {
      await prisma.productSearchDocument.upsert({
        where: { productId: product.id },
        update: {
          title: product.name,
          brandName: product.brand?.name ?? null,
          categoryPath: product.primaryCategory?.path ?? null,
          keywords: buildKeywords(product),
          content: buildContent(product),
        },
        create: {
          productId: product.id,
          title: product.name,
          brandName: product.brand?.name ?? null,
          categoryPath: product.primaryCategory?.path ?? null,
          keywords: buildKeywords(product),
          content: buildContent(product),
        },
      });
      indexed += 1;
    }

    cursor = page[page.length - 1]!.id;
    await context?.progress(indexed, total);
  }

  // Documents whose product is no longer live. Left behind, these are how a
  // draft product keeps appearing in search a week after it was unpublished.
  const stale = await prisma.productSearchDocument.findMany({
    where: { product: { OR: [{ status: { not: 'ACTIVE' } }, { deletedAt: { not: null } }] } },
    select: { productId: true },
  });

  if (stale.length > 0) {
    const result = await prisma.productSearchDocument.deleteMany({
      where: { productId: { in: stale.map((row) => row.productId) } },
    });
    removed = result.count;
  }

  const elapsedMs = Date.now() - started;
  logger.info('search.reindexed', { indexed, removed, elapsedMs });

  return { indexed, removed, elapsedMs };
}
