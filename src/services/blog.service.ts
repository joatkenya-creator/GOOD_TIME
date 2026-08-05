import 'server-only';

import { cache } from 'react';

import { prisma } from '@/lib/prisma';

/**
 * Editorial reads.
 *
 * ## The embargo rule
 *
 * A post is visible only when `status = PUBLISHED` **and** `publishedAt` is in
 * the past. Both halves matter: the status alone leaks a scheduled post the
 * moment an editor sets it, which is the classic embargo bug, and the date
 * alone would show a draft that happens to carry an old date.
 *
 * `LIVE` exists so no caller can express that predicate slightly differently.
 * The one place it is deliberately relaxed is the admin, which has its own
 * queries and needs to see drafts.
 *
 * ## Why editorial exists at all here
 *
 * The questions people type are informational long before they are
 * transactional — "is silicone body safe", "how do I clean this" — and those
 * searches cannot be won with a product page. This is the surface that answers
 * them.
 */

/** Published, and not scheduled for later. Never inline this predicate. */
function live() {
  return { status: 'PUBLISHED', deletedAt: null, publishedAt: { lte: new Date() } } as const;
}

const CARD_SELECT = {
  slug: true,
  title: true,
  excerpt: true,
  readingMinutes: true,
  publishedAt: true,
  authorName: true,
  tags: { select: { slug: true, name: true } },
} as const;

export interface PostCard {
  slug: string;
  title: string;
  excerpt: string | null;
  readingMinutes: number;
  publishedAt: Date | null;
  authorName: string;
  tags: { slug: string; name: string }[];
}

/**
 * Published posts, newest first.
 *
 * `cache` so the index page and the metadata generator that runs alongside it
 * share one query rather than issuing two identical ones per render.
 */
export const listPosts = cache(
  async (options: { take?: number; skip?: number } = {}): Promise<PostCard[]> =>
    prisma.post.findMany({
      where: live(),
      orderBy: { publishedAt: 'desc' },
      select: CARD_SELECT,
      take: options.take ?? 24,
      ...(options.skip ? { skip: options.skip } : {}),
    }),
);

export const countPosts = cache(async (): Promise<number> => prisma.post.count({ where: live() }));

export const getPostBySlug = cache(async (slug: string) =>
  prisma.post.findFirst({
    where: { slug, ...live() },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      readingMinutes: true,
      publishedAt: true,
      updatedAt: true,
      authorName: true,
      seo: true,
      tags: { select: { slug: true, name: true } },
    },
  }),
);

/** Slugs for `generateStaticParams` and the sitemap. */
export async function listPostSlugs(limit = 1000) {
  return prisma.post.findMany({
    where: live(),
    select: { slug: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

/**
 * Other posts to read next, excluding the current one.
 *
 * Deliberately not "related by tag". With a small archive, tag-matching
 * frequently returns nothing and the section disappears — which looks broken.
 * Recency always has an answer, and at this size it is very nearly as relevant.
 */
export async function listOtherPosts(excludeSlug: string, take = 3): Promise<PostCard[]> {
  return prisma.post.findMany({
    where: { ...live(), slug: { not: excludeSlug } },
    orderBy: { publishedAt: 'desc' },
    select: CARD_SELECT,
    take,
  });
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

/**
 * A published CMS page.
 *
 * The admin has had a Pages screen since phase 6, and nothing on the storefront
 * could render what it produced — `/pages/[slug]` served two hardcoded legal
 * documents and refused every other slug. So a merchant writing a returns
 * policy saved it successfully and it stayed invisible.
 *
 * Same embargo predicate as posts, for the same reason.
 */
export const getPageBySlug = cache(async (slug: string) =>
  prisma.page.findFirst({
    where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
    select: {
      slug: true,
      title: true,
      content: true,
      publishedAt: true,
      updatedAt: true,
      seo: true,
    },
  }),
);

/** Published page slugs, for `generateStaticParams` and the sitemap. */
export async function listPageSlugs(limit = 200) {
  return prisma.page.findMany({
    where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
    select: { slug: true },
    take: limit,
  });
}
