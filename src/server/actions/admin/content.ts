'use server';

import { revalidatePath } from 'next/cache';

import { PERMISSIONS, type Permission } from '@/constants/permissions';
import type { ContentBlockType, PostStatus } from '@/generated/prisma/enums';
import { withAdminAction } from '@/server/auth/admin';
import {
  addMenuItem,
  deleteContentBlock,
  deleteMenuItem,
  deleteRedirect,
  setSetting,
  upsertContentBlock,
  upsertPage,
  upsertPost,
  upsertRedirect,
} from '@/services/admin/content-admin.service';

/**
 * Content, blog, SEO and settings actions.
 *
 * Publishing is a separate permission from writing throughout. A content
 * editor drafts; someone with `content:publish` decides it goes live. Merging
 * them would make the distinction the role list promises meaningless.
 */

function publishPermission(status: string, write: Permission, publish: Permission): Permission {
  return status === 'PUBLISHED' ? publish : write;
}

export async function savePageAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;
  const status = String(formData.get('status') ?? 'DRAFT') as PostStatus;

  await withAdminAction(
    publishPermission(status, PERMISSIONS.contentWrite, PERMISSIONS.contentPublish),
    () =>
      upsertPage({
        id,
        slug: String(formData.get('slug') ?? ''),
        title: String(formData.get('title') ?? '').trim(),
        content: String(formData.get('content') ?? ''),
        status,
      }),
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'Page',
      entityId: result.id,
      changes: { title: { from: null, to: result.title }, status: { from: null, to: status } },
    }),
  );

  revalidatePath('/admin/content');
  revalidatePath('/pages', 'layout');
}

export async function saveContentBlockAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;
  const startsAt = String(formData.get('startsAt') ?? '');
  const endsAt = String(formData.get('endsAt') ?? '');

  await withAdminAction(
    PERMISSIONS.contentWrite,
    () =>
      upsertContentBlock({
        id,
        type: String(formData.get('type') ?? 'FAQ') as ContentBlockType,
        title: String(formData.get('title') ?? '').trim(),
        body: String(formData.get('body') ?? '') || null,
        linkUrl: String(formData.get('linkUrl') ?? '') || null,
        linkLabel: String(formData.get('linkLabel') ?? '') || null,
        group: String(formData.get('group') ?? '') || null,
        position: Number(formData.get('position') ?? 0) || 0,
        isActive: formData.get('isActive') === 'on',
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      }),
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'ContentBlock',
      entityId: result.id,
      changes: { title: { from: null, to: result.title }, type: { from: null, to: result.type } },
    }),
  );

  revalidatePath('/admin/content');
  revalidatePath('/', 'layout');
}

export async function deleteContentBlockAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.contentWrite,
    () => deleteContentBlock(id),
    () => ({ action: 'DELETE' as const, entityType: 'ContentBlock', entityId: id }),
  );

  revalidatePath('/admin/content');
  revalidatePath('/', 'layout');
}

export async function addMenuItemAction(formData: FormData): Promise<void> {
  const menuId = String(formData.get('menuId') ?? '');
  if (!menuId) return;

  await withAdminAction(
    PERMISSIONS.contentWrite,
    () =>
      addMenuItem({
        menuId,
        label: String(formData.get('label') ?? '').trim(),
        url: String(formData.get('url') ?? '').trim(),
        parentId: String(formData.get('parentId') ?? '') || null,
        position: Number(formData.get('position') ?? 0) || 0,
        isExternal: formData.get('isExternal') === 'on',
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'NavigationItem',
      entityId: result.id,
      changes: { label: { from: null, to: result.label }, url: { from: null, to: result.url } },
    }),
  );

  revalidatePath('/admin/content');
  revalidatePath('/', 'layout');
}

export async function deleteMenuItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.contentWrite,
    () => deleteMenuItem(id),
    () => ({ action: 'DELETE' as const, entityType: 'NavigationItem', entityId: id }),
  );

  revalidatePath('/admin/content');
  revalidatePath('/', 'layout');
}

export async function savePostAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;
  const status = String(formData.get('status') ?? 'DRAFT') as PostStatus;

  await withAdminAction(
    publishPermission(status, PERMISSIONS.blogWrite, PERMISSIONS.blogPublish),
    (actor) =>
      upsertPost({
        id,
        slug: String(formData.get('slug') ?? ''),
        title: String(formData.get('title') ?? '').trim(),
        excerpt: String(formData.get('excerpt') ?? '') || null,
        content: String(formData.get('content') ?? ''),
        status,
        // Defaults to the signed-in author, but is editable — a shop's posts
        // are often written by someone without an admin account.
        authorName: String(formData.get('authorName') ?? '').trim() || actor.name || actor.email,
        tagNames: String(formData.get('tags') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'Post',
      entityId: result.id,
      changes: { title: { from: null, to: result.title }, status: { from: null, to: status } },
    }),
  );

  revalidatePath('/admin/blog');
  revalidatePath('/guides', 'layout');
}

export async function saveRedirectAction(formData: FormData): Promise<void> {
  await withAdminAction(
    PERMISSIONS.seoWrite,
    (actor) =>
      upsertRedirect({
        source: String(formData.get('source') ?? ''),
        destination: String(formData.get('destination') ?? ''),
        statusCode: Number(formData.get('statusCode') ?? 301),
        isActive: formData.get('isActive') !== 'off',
        note: String(formData.get('note') ?? '') || null,
        createdBy: actor.id,
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'Redirect',
      entityId: result.id,
      changes: {
        source: { from: null, to: result.source },
        destination: { from: null, to: result.destination },
      },
    }),
  );

  revalidatePath('/admin/seo');
}

export async function deleteRedirectAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.seoWrite,
    () => deleteRedirect(id),
    () => ({ action: 'DELETE' as const, entityType: 'Redirect', entityId: id }),
  );

  revalidatePath('/admin/seo');
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const group = String(formData.get('group') ?? 'general');

  /*
   * Everything prefixed `setting.` is written; anything else in the form is
   * ignored. An allow-list by prefix rather than a deny-list, so adding a
   * hidden field to a settings form can never write it into the database.
   */
  const entries = [...formData.entries()]
    .filter(([key]) => key.startsWith('setting.'))
    .map(([key, value]) => [key.slice('setting.'.length), String(value)] as const);

  await withAdminAction(
    PERMISSIONS.settingsWrite,
    async () => {
      for (const [key, value] of entries) {
        await setSetting(key, value, group);
      }
      return entries.length;
    },
    (count) => ({
      action: 'UPDATE' as const,
      entityType: 'Setting',
      entityId: group,
      changes: Object.fromEntries(entries.map(([key, value]) => [key, { from: null, to: value }])),
      // The count is what makes "someone changed settings" answerable later.
      ...(count === 0 ? {} : {}),
    }),
  );

  revalidatePath('/admin/settings');
}
