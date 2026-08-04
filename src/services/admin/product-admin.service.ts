import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { ProductStatus } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * Product administration.
 *
 * Read paths deliberately do not reuse the storefront's `listProducts`: that
 * one only ever returns sellable products, because a shopper must never see a
 * draft. The admin's whole job is the opposite — it needs the drafts, the
 * archived, and the ones with no price set. Sharing the query would mean a flag
 * that turns the safety off, and a flag like that is eventually passed by
 * accident from the storefront.
 */

export interface ProductListQuery {
  q?: string;
  status?: string;
  categoryId?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const SORTABLE: Record<string, (direction: 'asc' | 'desc') => Prisma.ProductOrderByWithRelationInput> = {
  name: (direction) => ({ name: direction }),
  price: (direction) => ({ minPriceCents: direction }),
  sold: (direction) => ({ soldCount: direction }),
  updatedAt: (direction) => ({ updatedAt: direction }),
  createdAt: (direction) => ({ createdAt: direction }),
};

export async function listAdminProducts(query: ProductListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 10), 100);
  const direction = query.direction ?? 'desc';

  const where: Prisma.ProductWhereInput = {
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { sku: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
            { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(query.status && query.status !== 'all'
      ? query.status === 'scheduled'
        ? // Scheduled is derived, not stored — see `features/admin/status.ts`.
          { publishedAt: { gt: new Date() } }
        : { status: query.status as ProductStatus }
      : {}),
    ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
  };

  const orderBy = (SORTABLE[query.sort ?? 'updatedAt'] ?? SORTABLE.updatedAt!)(direction);

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        status: true,
        publishedAt: true,
        minPriceCents: true,
        maxPriceCents: true,
        soldCount: true,
        updatedAt: true,
        isFeatured: true,
        brand: { select: { name: true } },
        categories: { select: { category: { select: { name: true } } }, take: 2 },
        // Enough to show a stock column without a second round trip per row.
        variants: { select: { id: true, inventory: { select: { quantity: true, reserved: true } } } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map((product) => ({
      ...product,
      stock: product.variants.reduce(
        (sum, variant) =>
          sum + Math.max(0, (variant.inventory?.quantity ?? 0) - (variant.inventory?.reserved ?? 0)),
        0,
      ),
      variantCount: product.variants.length,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type AdminProductRow = Awaited<ReturnType<typeof listAdminProducts>>['items'][number];

/** Everything the editor needs, in one query. */
export async function getAdminProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      seo: true,
      brand: { select: { id: true, name: true } },
      categories: { select: { categoryId: true } },
      collections: { select: { collectionId: true } },
      media: { include: { media: true }, orderBy: { position: 'asc' } },
      variants: {
        orderBy: { position: 'asc' },
        include: { inventory: true },
      },
      productAttributes: { include: { definition: true } },
      relationsFrom: { include: { related: { select: { id: true, name: true } } } },
    },
  });
}

export type AdminProduct = NonNullable<Awaited<ReturnType<typeof getAdminProduct>>>;

export interface ProductInput {
  name: string;
  slug: string;
  subtitle?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  status: ProductStatus;
  publishedAt?: Date | null;
  sku?: string | null;
  barcode?: string | null;
  brandId?: string | null;
  isFeatured?: boolean;
  isAdultOnly?: boolean;
  categoryIds?: string[];
  collectionIds?: string[];
  seo?: {
    title?: string | null;
    description?: string | null;
    canonicalUrl?: string | null;
    ogTitle?: string | null;
    ogDescription?: string | null;
    noindex?: boolean;
  } | null;
}

/**
 * Slug uniqueness, resolved by suffixing rather than by rejecting.
 *
 * "Rose Quartz Wand" existing already is not an error the person naming their
 * second one should have to solve. Excluding the current row matters or saving
 * a product without renaming it would bump its own slug every time.
 */
export async function ensureUniqueSlug(slug: string, exceptId?: string): Promise<string> {
  const base = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  if (!base) throw errors.badRequest('A product needs a name that produces a URL.');

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.product.findFirst({
      where: { slug: candidate, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }

  throw errors.badRequest('Could not find a free URL for that name.');
}

export async function createProduct(input: ProductInput) {
  const slug = await ensureUniqueSlug(input.slug || input.name);

  /*
   * The SEO row is written first and linked by id.
   *
   * Prisma refuses a payload that mixes scalar foreign keys (`brandId`) with
   * nested writes (`seo: { create }`) — it cannot tell which style the whole
   * object is in. Creating the one nested record up front keeps everything
   * else a plain scalar assignment.
   */
  const seo = input.seo ? await prisma.seoMetadata.create({ data: stripSeo(input.seo) }) : null;

  return prisma.product.create({
    data: {
      name: input.name,
      slug,
      subtitle: input.subtitle ?? null,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      status: input.status,
      publishedAt: input.publishedAt ?? (input.status === 'ACTIVE' ? new Date() : null),
      sku: input.sku || null,
      barcode: input.barcode || null,
      brandId: input.brandId || null,
      isFeatured: input.isFeatured ?? false,
      isAdultOnly: input.isAdultOnly ?? true,
      ...(input.categoryIds?.length
        ? { categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) } }
        : {}),
      ...(input.collectionIds?.length
        ? { collections: { create: input.collectionIds.map((collectionId) => ({ collectionId })) } }
        : {}),
      seoId: seo?.id ?? null,
    },
  });
}

export async function updateProduct(id: string, input: ProductInput) {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true, slug: true, seoId: true, status: true, publishedAt: true },
  });
  if (!existing) throw errors.notFound('Product');

  const slug =
    input.slug && input.slug !== existing.slug
      ? await ensureUniqueSlug(input.slug, id)
      : existing.slug;

  /*
   * First publication stamps `publishedAt`; later edits leave it alone.
   *
   * Re-stamping on every save would move the product back to the top of "newest
   * first" for a typo fix, which is how a six-month-old product ends up on the
   * new arrivals rail.
   */
  const publishedAt =
    input.publishedAt !== undefined
      ? input.publishedAt
      : input.status === 'ACTIVE' && !existing.publishedAt
        ? new Date()
        : existing.publishedAt;

  /*
   * Same reason as `createProduct`: scalars and nested writes cannot mix, so
   * the SEO record is settled before the product update runs.
   */
  let seoId = existing.seoId;
  if (input.seo) {
    if (existing.seoId) {
      await prisma.seoMetadata.update({ where: { id: existing.seoId }, data: stripSeo(input.seo) });
    } else {
      seoId = (await prisma.seoMetadata.create({ data: stripSeo(input.seo) })).id;
    }
  }

  return prisma.$transaction(async (tx) => {
    // Replace-in-place for the join tables: an editor's checkbox list is the
    // whole truth, and diffing it here would be more code for the same result.
    if (input.categoryIds) {
      await tx.productCategory.deleteMany({ where: { productId: id } });
      if (input.categoryIds.length > 0) {
        await tx.productCategory.createMany({
          data: input.categoryIds.map((categoryId) => ({ productId: id, categoryId })),
        });
      }
    }

    if (input.collectionIds) {
      await tx.productCollection.deleteMany({ where: { productId: id } });
      if (input.collectionIds.length > 0) {
        await tx.productCollection.createMany({
          data: input.collectionIds.map((collectionId) => ({ productId: id, collectionId })),
        });
      }
    }

    return tx.product.update({
      where: { id },
      data: {
        name: input.name,
        slug,
        subtitle: input.subtitle ?? null,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        status: input.status,
        publishedAt,
        sku: input.sku || null,
        barcode: input.barcode || null,
        brandId: input.brandId || null,
        isFeatured: input.isFeatured ?? false,
        isAdultOnly: input.isAdultOnly ?? true,
        seoId,
      },
    });
  });
}

function stripSeo(seo: NonNullable<ProductInput['seo']>) {
  return {
    title: seo.title || null,
    description: seo.description || null,
    canonicalUrl: seo.canonicalUrl || null,
    ogTitle: seo.ogTitle || null,
    ogDescription: seo.ogDescription || null,
    noindex: seo.noindex ?? false,
  };
}

/**
 * Copies a product, its variants and its media, as a draft.
 *
 * Always a draft, whatever the original was: duplicating is how a new product
 * gets started, and a copy that went live the moment it was made would put an
 * unedited "Copy of…" on the shop.
 *
 * SKUs get a suffix rather than being copied — a SKU is unique by definition,
 * and silently blanking them would produce variants nobody can pick or ship.
 */
export async function duplicateProduct(id: string) {
  const source = await prisma.product.findUnique({
    where: { id },
    include: { variants: true, media: true, categories: true, collections: true },
  });
  if (!source) throw errors.notFound('Product');

  const slug = await ensureUniqueSlug(`${source.slug}-copy`);
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();

  return prisma.product.create({
    data: {
      name: `${source.name} (copy)`,
      slug,
      subtitle: source.subtitle,
      shortDescription: source.shortDescription,
      description: source.description,
      status: 'DRAFT',
      publishedAt: null,
      sku: source.sku ? `${source.sku}-${suffix}` : null,
      brandId: source.brandId,
      isAdultOnly: source.isAdultOnly,
      minPriceCents: source.minPriceCents,
      maxPriceCents: source.maxPriceCents,
      categories: { create: source.categories.map((row) => ({ categoryId: row.categoryId })) },
      collections: { create: source.collections.map((row) => ({ collectionId: row.collectionId })) },
      media: {
        create: source.media.map((row) => ({ mediaId: row.mediaId, position: row.position })),
      },
      variants: {
        create: source.variants.map((variant) => ({
          sku: `${variant.sku}-${suffix}`,
          name: variant.name,
          priceCents: variant.priceCents,
          salePriceCents: variant.salePriceCents,
          compareAtPriceCents: variant.compareAtPriceCents,
          position: variant.position,
          weightGrams: variant.weightGrams,
          isActive: variant.isActive,
          // Stock does not copy. The duplicate has none until someone receives it.
          inventory: { create: { quantity: 0, reserved: 0 } },
        })),
      },
    },
  });
}

/**
 * Bulk actions.
 *
 * `updateMany` in one statement rather than a loop: four hundred round trips is
 * a timeout, and a partial loop leaves half the selection changed with no
 * record of where it stopped.
 */
export type BulkAction = 'publish' | 'draft' | 'archive' | 'restore' | 'feature' | 'unfeature' | 'delete';

export async function bulkUpdateProducts(ids: string[], action: BulkAction): Promise<number> {
  if (ids.length === 0) return 0;

  const where = { id: { in: ids } };

  switch (action) {
    case 'publish':
      // `publishedAt` is only stamped where it is missing, so republishing an
      // old product does not pretend it is new.
      await prisma.product.updateMany({
        where: { ...where, publishedAt: null },
        data: { publishedAt: new Date() },
      });
      return (await prisma.product.updateMany({ where, data: { status: 'ACTIVE' } })).count;

    case 'draft':
      return (await prisma.product.updateMany({ where, data: { status: 'DRAFT' } })).count;

    case 'archive':
      return (await prisma.product.updateMany({ where, data: { status: 'ARCHIVED' } })).count;

    case 'restore':
      return (await prisma.product.updateMany({ where, data: { status: 'DRAFT' } })).count;

    case 'feature':
      return (await prisma.product.updateMany({ where, data: { isFeatured: true } })).count;

    case 'unfeature':
      return (await prisma.product.updateMany({ where, data: { isFeatured: false } })).count;

    case 'delete':
      return deleteProducts(ids);
  }
}

/**
 * Deletes products that have never been ordered; archives the rest.
 *
 * An order item keeps its own name, SKU and price, so deleting a sold product
 * does not corrupt history — but it does break the link from a customer's
 * order back to the thing they bought, and from a refund to what is being
 * refunded. Archiving keeps that intact, and the caller is told what happened
 * rather than being left to assume the delete worked.
 */
export async function deleteProducts(ids: string[]): Promise<number> {
  const sold = await prisma.variant.findMany({
    where: { productId: { in: ids }, orderItems: { some: {} } },
    select: { productId: true },
    distinct: ['productId'],
  });

  const soldIds = new Set(sold.map((row) => row.productId));
  const deletable = ids.filter((id) => !soldIds.has(id));

  if (soldIds.size > 0) {
    await prisma.product.updateMany({
      where: { id: { in: [...soldIds] } },
      data: { status: 'ARCHIVED' },
    });
  }

  if (deletable.length === 0) return 0;

  const result = await prisma.product.deleteMany({ where: { id: { in: deletable } } });
  return result.count;
}

/** Applies a percentage or fixed change across every variant of a selection. */
export async function bulkAdjustPrices(
  ids: string[],
  change: { mode: 'percent' | 'fixed'; amount: number },
): Promise<number> {
  if (ids.length === 0 || change.amount === 0) return 0;

  const variants = await prisma.variant.findMany({
    where: { productId: { in: ids } },
    select: { id: true, priceCents: true },
  });

  await prisma.$transaction(
    variants.map((variant) => {
      const next =
        change.mode === 'percent'
          ? Math.round(variant.priceCents * (1 + change.amount / 100))
          : variant.priceCents + change.amount;

      return prisma.variant.update({
        where: { id: variant.id },
        // Never below a cent. A rounding error that makes something free is a
        // rounding error someone will find and exploit.
        data: { priceCents: Math.max(1, next) },
      });
    }),
  );

  await syncProductPriceRange(ids);
  return variants.length;
}

/**
 * Rebuilds the denormalised price range from the variants.
 *
 * `Product.minPriceCents` / `maxPriceCents` exist so the storefront can sort
 * and filter by price without a join. Anything that changes a variant price has
 * to call this, or the shop keeps showing yesterday's number.
 */
export async function syncProductPriceRange(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const grouped = await prisma.variant.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, isActive: true },
    _min: { priceCents: true },
    _max: { priceCents: true },
  });

  await prisma.$transaction(
    grouped.map((row) =>
      prisma.product.update({
        where: { id: row.productId },
        data: {
          minPriceCents: row._min.priceCents ?? 0,
          maxPriceCents: row._max.priceCents ?? 0,
        },
      }),
    ),
  );
}

export async function assignCategory(ids: string[], categoryId: string): Promise<number> {
  if (ids.length === 0) return 0;

  // `skipDuplicates`, because assigning a category twice is a no-op the person
  // clicking meant, not an error worth showing them.
  const result = await prisma.productCategory.createMany({
    data: ids.map((productId) => ({ productId, categoryId })),
    skipDuplicates: true,
  });

  return result.count;
}

/** Options for the editor's select fields, in one round trip. */
export async function getProductFormOptions() {
  const [categories, collections, brands] = await Promise.all([
    prisma.category.findMany({
      orderBy: { path: 'asc' },
      select: { id: true, name: true, path: true, depth: true },
    }),
    prisma.collection.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return { categories, collections, brands };
}
