import 'server-only';

import { cache } from 'react';

import { prisma } from '@/lib/prisma';
import type { BreadcrumbEntry } from '@/lib/seo/json-ld';

/**
 * Category reads.
 *
 * Every lookup is by the materialised `path` column rather than by walking the
 * `parentId` chain. `/vibrators/wands` is one indexed equality; the recursive
 * alternative is a CTE per page render.
 */

const LIVE = { isActive: true, deletedAt: null } as const;

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  heroHeadline: true,
  heroBody: true,
  path: true,
  depth: true,
  parentId: true,
  seo: true,
} as const;

/** `["vibrators", "wands"]` -> `/vibrators/wands`. */
export function segmentsToPath(segments: string[]): string {
  return `/${segments.join('/')}`;
}

/**
 * Memoised for the same reason as `getProductBySlug`: the shop route resolves
 * a path in `generateMetadata` and again in the page body, and every product
 * URL tries this first before falling through to the product lookup.
 */
export const getCategoryByPath = cache(async (path: string) => {
  return prisma.category.findFirst({ where: { path, ...LIVE }, select: CATEGORY_SELECT });
});

export type CategoryView = NonNullable<Awaited<ReturnType<typeof getCategoryByPath>>>;

/** Immediate children, for the "shop by type" links on a category page. */
export async function getChildCategories(parentId: string) {
  return prisma.category.findMany({
    where: { parentId, ...LIVE },
    orderBy: { position: 'asc' },
    select: { ...CATEGORY_SELECT, _count: { select: { products: true } } },
  });
}

/**
 * Sibling categories, used for the "related categories" block.
 *
 * Internal links between sibling categories are how crawl equity reaches deep
 * pages that the primary navigation does not list.
 */
export async function getSiblingCategories(category: { id: string; parentId: string | null }) {
  return prisma.category.findMany({
    where: { parentId: category.parentId, id: { not: category.id }, ...LIVE },
    orderBy: { position: 'asc' },
    take: 8,
    select: { slug: true, name: true, path: true },
  });
}

/**
 * Ancestor chain, derived from the path string.
 *
 * One `IN` query for the whole trail instead of one query per level.
 */
export async function getCategoryTrail(path: string): Promise<BreadcrumbEntry[]> {
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);

  const paths = segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);

  const categories = await prisma.category.findMany({
    where: { path: { in: paths } },
    select: { name: true, path: true },
  });

  const byPath = new Map(categories.map((entry) => [entry.path, entry.name]));

  return [
    { name: 'Shop', path: '/shop' },
    ...paths.map((entryPath) => ({
      name: byPath.get(entryPath) ?? humanise(entryPath.split('/').pop() ?? ''),
      path: `/shop${entryPath}`,
    })),
  ];
}

/** Top-level categories with product counts, for the shop landing page. */
export async function getTopLevelCategories() {
  return prisma.category.findMany({
    where: { parentId: null, ...LIVE },
    orderBy: { position: 'asc' },
    select: {
      slug: true,
      name: true,
      path: true,
      description: true,
      _count: { select: { products: true } },
    },
  });
}

/**
 * Every live category path, for `generateStaticParams` and the sitemap.
 */
export async function listCategoryPaths() {
  return prisma.category.findMany({
    where: LIVE,
    orderBy: { path: 'asc' },
    select: { path: true, updatedAt: true },
  });
}

/**
 * Products in a category *and all of its descendants*.
 *
 * `path LIKE '/vibrators%'` covers the subtree in one indexed scan, which is the
 * whole reason `path` is materialised. A category page that only listed its own
 * direct products would show almost nothing on a parent category.
 */
export function subtreeProductFilter(path: string) {
  return {
    categories: {
      some: { category: { path: { startsWith: path }, ...LIVE } },
    },
  };
}

export async function getCollectionBySlug(slug: string) {
  return prisma.collection.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      seo: true,
      _count: { select: { products: true } },
    },
  });
}

export async function listCollections() {
  return prisma.collection.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
    select: { slug: true, title: true, description: true, _count: { select: { products: true } } },
  });
}

export async function listBrands() {
  return prisma.brand.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { slug: true, name: true, description: true, _count: { select: { products: true } } },
  });
}

function humanise(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
