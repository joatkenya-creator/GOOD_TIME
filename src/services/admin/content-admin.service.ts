import 'server-only';

import type { ContentBlockType, PostStatus } from '@/generated/prisma/enums';
import { errors } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';

/**
 * Content, blog, SEO and settings.
 *
 * A lightweight CMS, deliberately. It manages the small editable pieces of a
 * shop — pages, banners, FAQs, menus, redirects — and stops well short of
 * being a general publishing platform, because a shop that needs one has
 * outgrown having it bolted to the checkout.
 */

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function listPages() {
  return prisma.page.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
}

export async function getPage(id: string) {
  return prisma.page.findUnique({ where: { id }, include: { seo: true } });
}

export async function upsertPage(input: {
  id?: string;
  slug: string;
  title: string;
  content: string;
  status: PostStatus;
  publishedAt?: Date | null;
}) {
  const slug = input.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) throw errors.badRequest('A page needs a URL segment.');

  const clash = await prisma.page.findFirst({
    where: { slug, ...(input.id ? { NOT: { id: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw errors.badRequest(`Another page already uses /${slug}.`);

  const data = {
    slug,
    title: input.title,
    content: input.content,
    status: input.status,
    // Stamped on first publication only, so an edit does not reorder the list.
    publishedAt: input.publishedAt ?? (input.status === 'PUBLISHED' ? new Date() : null),
  };

  return input.id
    ? prisma.page.update({ where: { id: input.id }, data })
    : prisma.page.create({ data });
}

// ---------------------------------------------------------------------------
// Content blocks: announcements, banners, FAQs, footer links
// ---------------------------------------------------------------------------

export async function listContentBlocks(type?: ContentBlockType) {
  return prisma.contentBlock.findMany({
    where: type ? { type } : {},
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
    include: { image: { select: { url: true } } },
  });
}

export type ContentBlockRow = Awaited<ReturnType<typeof listContentBlocks>>[number];

export async function upsertContentBlock(input: {
  id?: string;
  type: ContentBlockType;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  group?: string | null;
  position: number;
  isActive: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw errors.badRequest('The end date has to be after the start date.');
  }

  const data = {
    type: input.type,
    title: input.title,
    body: input.body || null,
    linkUrl: input.linkUrl || null,
    linkLabel: input.linkLabel || null,
    group: input.group || null,
    position: input.position,
    isActive: input.isActive,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
  };

  return input.id
    ? prisma.contentBlock.update({ where: { id: input.id }, data })
    : prisma.contentBlock.create({ data });
}

export async function deleteContentBlock(id: string): Promise<void> {
  await prisma.contentBlock.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export async function listMenus() {
  return prisma.navigationMenu.findMany({
    orderBy: { key: 'asc' },
    include: {
      items: {
        orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          label: true,
          url: true,
          position: true,
          isActive: true,
          isExternal: true,
          parentId: true,
        },
      },
    },
  });
}

export async function addMenuItem(input: {
  menuId: string;
  label: string;
  url: string;
  parentId?: string | null;
  position: number;
  isExternal: boolean;
}) {
  return prisma.navigationItem.create({
    data: {
      menuId: input.menuId,
      label: input.label,
      url: input.url,
      parentId: input.parentId || null,
      position: input.position,
      isExternal: input.isExternal,
    },
  });
}

export async function deleteMenuItem(id: string): Promise<void> {
  await prisma.navigationItem.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

export async function listPosts(query: { q?: string; status?: string } = {}) {
  return prisma.post.findMany({
    where: {
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.status && query.status !== 'all' ? { status: query.status as PostStatus } : {}),
    },
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    take: 100,
    include: { tags: { select: { name: true } } },
  });
}

export type AdminPostRow = Awaited<ReturnType<typeof listPosts>>[number];

export async function upsertPost(input: {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  status: PostStatus;
  authorName: string;
  publishedAt?: Date | null;
  tagNames?: string[];
}) {
  const slug = input.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) throw errors.badRequest('A post needs a URL segment.');

  /*
   * Tags are connect-or-create by name.
   *
   * Writers type tag names; making them pick from a managed list first is how
   * posts end up untagged. Duplicates collapse because the name is unique.
   */
  const tags = (input.tagNames ?? [])
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

  const data = {
    slug,
    title: input.title,
    excerpt: input.excerpt || null,
    content: input.content,
    status: input.status,
    // The name is stored, not a foreign key: a post keeps its byline when the
    // staff account that wrote it is closed, which is what a byline is for.
    authorName: input.authorName,
    readingMinutes: Math.max(1, Math.round(input.content.split(/\s+/).length / 200)),
    publishedAt: input.publishedAt ?? (input.status === 'PUBLISHED' ? new Date() : null),
  };

  /*
   * Tags are connect-or-create, and `set: []` is update-only.
   *
   * Sharing one payload between create and update looked tidy and made every
   * post creation fail with a Prisma validation error — `set` clears an
   * existing relation, which a row that does not exist yet cannot have. The
   * clear is only meaningful on update, where it makes the submitted list the
   * whole truth rather than something that only ever accumulates.
   */
  const tagConnect = tags.map((name) => {
    const slug = name.replace(/[^a-z0-9]+/g, '-');
    return { where: { slug }, create: { name, slug } };
  });

  if (input.id) {
    return prisma.post.update({
      where: { id: input.id },
      data: {
        ...data,
        ...(tags.length > 0 ? { tags: { set: [], connectOrCreate: tagConnect } } : {}),
      },
    });
  }

  return prisma.post.create({
    data: {
      ...data,
      ...(tags.length > 0 ? { tags: { connectOrCreate: tagConnect } } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

export async function listRedirects() {
  return prisma.redirect.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { creator: { select: { firstName: true, email: true } } },
  });
}

export type RedirectRow = Awaited<ReturnType<typeof listRedirects>>[number];

export async function upsertRedirect(input: {
  id?: string;
  source: string;
  destination: string;
  statusCode: number;
  isActive: boolean;
  note?: string | null;
  createdBy?: string | null;
}) {
  // Paths only, normalised. A redirect with a host in it is a redirect that
  // stops working the first time the domain changes.
  const source = normalisePath(input.source);
  const destination = input.destination.startsWith('http')
    ? input.destination
    : normalisePath(input.destination);

  if (source === destination) {
    throw errors.badRequest('That redirect points at itself.');
  }

  /*
   * One hop only, checked at write time.
   *
   * A → B where B → C means a crawler follows two redirects and loses ranking
   * signal on each; a cycle means it follows them until it gives up. Catching
   * it here is far cheaper than discovering it in a log.
   */
  const onward = await prisma.redirect.findUnique({
    where: { source: destination },
    select: { destination: true },
  });
  if (onward) {
    throw errors.badRequest(
      `${destination} already redirects to ${onward.destination}. Point this one straight there instead.`,
    );
  }

  const data = {
    source,
    destination,
    statusCode: input.statusCode === 302 ? 302 : 301,
    isActive: input.isActive,
    note: input.note || null,
    createdBy: input.createdBy ?? null,
  };

  return input.id
    ? prisma.redirect.update({ where: { id: input.id }, data })
    : prisma.redirect.create({ data });
}

function normalisePath(value: string): string {
  const trimmed = value.trim();
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export async function deleteRedirect(id: string): Promise<void> {
  await prisma.redirect.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(group?: string) {
  const rows = await prisma.setting.findMany({
    where: group ? { group } : {},
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
  });

  return rows;
}

/**
 * Writes a setting.
 *
 * Anything secret belongs in the environment, not here: this table is readable
 * by every process with a database connection and shows up in backups. The
 * settings screen says so rather than trusting people to know.
 */
export async function setSetting(key: string, value: unknown, group = 'general'): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as never, group },
    create: { key, value: value as never, group },
  });
}

export async function getSettingsMap(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
