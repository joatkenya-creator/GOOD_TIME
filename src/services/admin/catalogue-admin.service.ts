import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * Categories, collections and media.
 *
 * Three small modules in one file because they share one shape — a tree or a
 * list, a slug, an image, an SEO record — and splitting them into three files
 * of forty lines each would be filing, not architecture.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The whole tree, ordered by materialised path.
 *
 * `path` sorting gives depth-first order for free: `/vibrators` sorts directly
 * before `/vibrators/bullets`, so the list renders as a tree without a
 * recursive query or a client-side rebuild.
 */
export async function listCategoryTree() {
  const rows = await prisma.category.findMany({
    orderBy: [{ path: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      depth: true,
      position: true,
      isActive: true,
      parentId: true,
      image: { select: { url: true, alt: true } },
      _count: { select: { products: true, children: true } },
    },
  });

  return rows;
}

export type AdminCategoryRow = Awaited<ReturnType<typeof listCategoryTree>>[number];

export async function upsertCategory(input: {
  id?: string;
  name: string;
  slug: string;
  parentId?: string | null;
  description?: string | null;
  isActive: boolean;
  position: number;
}) {
  const slug = input.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) throw errors.badRequest('A category needs a URL segment.');

  /*
   * `path` and `depth` are derived from the parent, never entered.
   *
   * They are what makes the tree cheap to query, and a hand-typed path that
   * disagrees with `parentId` would put a category in two places at once —
   * visible in one, filtered by the other.
   */
  const parent = input.parentId
    ? await prisma.category.findUnique({
        where: { id: input.parentId },
        select: { path: true, depth: true },
      })
    : null;

  const path = parent ? `${parent.path}/${slug}` : `/${slug}`;
  const depth = parent ? parent.depth + 1 : 0;

  const data = {
    name: input.name,
    slug,
    path,
    depth,
    parentId: input.parentId || null,
    description: input.description || null,
    isActive: input.isActive,
    position: input.position,
  };

  if (input.id) {
    // Moving a parent has to move every descendant's path with it, or the
    // children keep pointing at a path that no longer exists.
    const before = await prisma.category.findUnique({
      where: { id: input.id },
      select: { path: true },
    });

    const updated = await prisma.category.update({ where: { id: input.id }, data });

    if (before && before.path !== path) {
      const descendants = await prisma.category.findMany({
        where: { path: { startsWith: `${before.path}/` } },
        select: { id: true, path: true, depth: true },
      });

      await prisma.$transaction(
        descendants.map((child) =>
          prisma.category.update({
            where: { id: child.id },
            data: {
              path: child.path.replace(before.path, path),
              depth: child.depth + (depth - (before.path.split('/').length - 1)),
            },
          }),
        ),
      );
    }

    return updated;
  }

  return prisma.category.create({ data });
}

export async function deleteCategory(id: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { _count: { select: { children: true, products: true } } },
  });
  if (!category) throw errors.notFound('Category');

  // Refusing rather than cascading. Deleting a category with products in it
  // silently unfiles them, and nobody notices until the shop page is empty.
  if (category._count.children > 0) {
    throw errors.badRequest('Move or delete the sub-categories first.');
  }
  if (category._count.products > 0) {
    throw errors.badRequest(
      `${category._count.products} products are still in this category. Move them first.`,
    );
  }

  await prisma.category.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export async function listCollections() {
  const now = Date.now();

  const rows = await prisma.collection.findMany({
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      isActive: true,
      position: true,
      startsAt: true,
      endsAt: true,
      rules: true,
      image: { select: { url: true } },
      _count: { select: { products: true } },
    },
  });

  /*
   * Live / scheduled / ended is decided here, not in the page.
   *
   * It is a fact about the row, and reading the clock during render means the
   * answer can differ between two renders of the same data.
   */
  return rows.map((collection) => ({
    ...collection,
    state: (collection.startsAt && collection.startsAt.getTime() > now
      ? 'scheduled'
      : collection.endsAt && collection.endsAt.getTime() < now
        ? 'ended'
        : collection.isActive
          ? 'live'
          : 'hidden') as 'scheduled' | 'ended' | 'live' | 'hidden',
  }));
}

export type AdminCollectionRow = Awaited<ReturnType<typeof listCollections>>[number];

/**
 * A collection is automatic when it has rules, manual when it does not.
 *
 * One nullable column rather than a `type` enum plus a rules column that must
 * agree with it — two fields that can contradict each other always eventually
 * do.
 */
export function isAutomatic(collection: { rules: Prisma.JsonValue | null }): boolean {
  return collection.rules !== null && collection.rules !== undefined;
}

export async function upsertCollection(input: {
  id?: string;
  title: string;
  slug: string;
  description?: string | null;
  isActive: boolean;
  position: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  rules?: Record<string, unknown> | null;
}) {
  const slug = input.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) throw errors.badRequest('A collection needs a URL segment.');

  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw errors.badRequest('The end date has to be after the start date.');
  }

  const data = {
    title: input.title,
    slug,
    description: input.description || null,
    isActive: input.isActive,
    position: input.position,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    rules: input.rules ? (input.rules as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };

  return input.id
    ? prisma.collection.update({ where: { id: input.id }, data })
    : prisma.collection.create({ data });
}

/**
 * Resolves an automatic collection's rules to a product set.
 *
 * Evaluated on read rather than materialised into the join table: a rule that
 * says "on sale" must stop including a product the moment its sale ends, and a
 * materialised set only updates when something remembers to re-run it.
 */
export async function resolveCollectionRules(
  rules: Prisma.JsonValue | null,
  limit = 100,
): Promise<{ id: string; name: string }[]> {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return [];

  const parsed = rules as {
    categoryId?: string;
    brandId?: string;
    isOnSale?: boolean;
    isNewArrival?: boolean;
    minPriceCents?: number;
    maxPriceCents?: number;
  };

  return prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      ...(parsed.categoryId ? { categories: { some: { categoryId: parsed.categoryId } } } : {}),
      ...(parsed.brandId ? { brandId: parsed.brandId } : {}),
      ...(parsed.isOnSale ? { isOnSale: true } : {}),
      ...(parsed.isNewArrival ? { isNewArrival: true } : {}),
      ...(parsed.minPriceCents ? { minPriceCents: { gte: parsed.minPriceCents } } : {}),
      ...(parsed.maxPriceCents ? { maxPriceCents: { lte: parsed.maxPriceCents } } : {}),
    },
    select: { id: true, name: true },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaQuery {
  q?: string;
  folder?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

export async function listMedia(query: MediaQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 40, 10), 100);

  const where: Prisma.MediaWhereInput = {
    ...(query.q
      ? {
          OR: [
            { alt: { contains: query.q, mode: 'insensitive' } },
            { publicId: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.folder ? { folder: query.folder } : {}),
    ...(query.type && query.type !== 'all'
      ? { type: query.type as Prisma.EnumMediaTypeFilter['equals'] }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.media.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { productMedia: true } } },
    }),
    prisma.media.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AdminMediaRow = Awaited<ReturnType<typeof listMedia>>['items'][number];

/**
 * Folders, derived from the column rather than stored in their own table.
 *
 * A folder is a label on an asset. Modelling it as a row would add a table, a
 * join and an orphan-cleanup problem to express something a `GROUP BY` already
 * answers.
 */
export async function listMediaFolders(): Promise<{ folder: string; count: number }[]> {
  const rows = await prisma.media.groupBy({
    by: ['folder'],
    _count: { _all: true },
    orderBy: { folder: 'asc' },
  });

  return rows
    .filter((row): row is typeof row & { folder: string } => Boolean(row.folder))
    .map((row) => ({ folder: row.folder, count: row._count._all }));
}

export async function updateMediaAlt(id: string, alt: string): Promise<void> {
  await prisma.media.update({ where: { id }, data: { alt: alt.trim() || null } });
}

/**
 * Deletes assets that nothing is using.
 *
 * Returns what it refused, rather than cascading. Removing an image still
 * attached to a product leaves a hole on a live page, and the person deleting
 * usually does not know it was in use — so they are told.
 */
export async function deleteMedia(ids: string[]): Promise<{ deleted: number; inUse: string[] }> {
  if (ids.length === 0) return { deleted: 0, inUse: [] };

  const attached = await prisma.productMedia.findMany({
    where: { mediaId: { in: ids } },
    select: { mediaId: true },
    distinct: ['mediaId'],
  });

  const inUse = new Set(attached.map((row) => row.mediaId));
  const deletable = ids.filter((id) => !inUse.has(id));

  if (deletable.length === 0) return { deleted: 0, inUse: [...inUse] };

  const result = await prisma.media.deleteMany({ where: { id: { in: deletable } } });
  return { deleted: result.count, inUse: [...inUse] };
}

/**
 * Registers an upload.
 *
 * The bytes go straight from the browser to Cloudinary; this only records the
 * result. Proxying the file through the app server would double the bandwidth
 * and put a 20MB upload on the request timeout.
 */
export async function registerMedia(input: {
  publicId: string;
  url: string;
  type?: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  format?: string | null;
  folder?: string | null;
}) {
  return prisma.media.upsert({
    where: { publicId: input.publicId },
    update: { url: input.url, alt: input.alt ?? undefined },
    create: {
      publicId: input.publicId,
      url: input.url,
      type: input.type ?? 'IMAGE',
      alt: input.alt ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes ?? null,
      format: input.format ?? null,
      folder: input.folder ?? null,
    },
  });
}
