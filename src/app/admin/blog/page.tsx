import type { Metadata } from 'next';

import { StatusPill } from '@/components/admin/data-table';
import { AdminCard, AdminPageHeader } from '@/components/admin/page-header';
import { PERMISSIONS } from '@/constants/permissions';
import { type RawSearchParams, formatDate, parseListParams } from '@/features/admin/query';
import { POST_STATUS_TONE, humaniseEnum } from '@/features/admin/status';
import { savePostAction } from '@/server/actions/admin/content';
import { requireAdminPermission } from '@/server/auth/admin';
import { can } from '@/server/auth/session';
import { listPosts } from '@/services/admin/content-admin.service';

export const metadata: Metadata = { title: 'Blog' };

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requireAdminPermission(PERMISSIONS.contentRead);
  const params = parseListParams(await searchParams);

  const posts = await listPosts({ q: params.q, status: params.status });
  const canWrite = can(user, PERMISSIONS.blogWrite);
  const canPublish = can(user, PERMISSIONS.blogPublish);

  return (
    <>
      <AdminPageHeader
        title="Blog"
        description={`${posts.length} posts. Buying guides are how this category earns organic search.`}
        pathname="/admin/blog"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <AdminCard title="Posts">
          {posts.length === 0 ? (
            <p className="py-8 text-center text-body-sm text-foreground-subtle">No posts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {posts.map((post) => (
                <li key={post.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">{post.title}</p>
                      <p className="text-body-xs truncate text-foreground-subtle">
                        /guides/{post.slug} · {post.authorName} · {post.readingMinutes} min read
                        {post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ''}
                      </p>
                      {post.tags.length > 0 ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {post.tags.map((tag) => (
                            <StatusPill key={tag.name} label={tag.name} tone="neutral" />
                          ))}
                        </p>
                      ) : null}
                    </div>

                    <StatusPill
                      label={humaniseEnum(post.status)}
                      tone={POST_STATUS_TONE[post.status]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {canWrite ? (
          <AdminCard title="New post">
            <form action={savePostAction} className="space-y-3">
              <div>
                <label htmlFor="post-title" className="mb-1.5 block text-body-sm font-medium">
                  Title
                </label>
                <input
                  id="post-title"
                  name="title"
                  required
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="post-slug" className="mb-1.5 block text-body-sm font-medium">
                  URL segment
                </label>
                <input
                  id="post-slug"
                  name="slug"
                  required
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="post-author" className="mb-1.5 block text-body-sm font-medium">
                  Byline
                </label>
                <input
                  id="post-author"
                  name="authorName"
                  placeholder="Defaults to you"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="post-excerpt" className="mb-1.5 block text-body-sm font-medium">
                  Excerpt
                </label>
                <textarea
                  id="post-excerpt"
                  name="excerpt"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body-sm"
                />
              </div>

              <div>
                <label htmlFor="post-content" className="mb-1.5 block text-body-sm font-medium">
                  Content
                </label>
                <textarea
                  id="post-content"
                  name="content"
                  rows={8}
                  required
                  className="text-body-xs w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono"
                />
                <p className="text-body-xs mt-1 text-foreground-subtle">
                  Reading time is calculated from the word count on save.
                </p>
              </div>

              <div>
                <label htmlFor="post-tags" className="mb-1.5 block text-body-sm font-medium">
                  Tags
                </label>
                <input
                  id="post-tags"
                  name="tags"
                  placeholder="materials, beginners"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                />
                <p className="text-body-xs mt-1 text-foreground-subtle">
                  Comma separated. New tags are created as you type them.
                </p>
              </div>

              <div>
                <label htmlFor="post-status" className="mb-1.5 block text-body-sm font-medium">
                  Status
                </label>
                <select
                  id="post-status"
                  name="status"
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-body-sm"
                >
                  <option value="DRAFT">Draft</option>
                  {canPublish ? <option value="PUBLISHED">Published</option> : null}
                </select>
                {!canPublish ? (
                  <p className="text-body-xs mt-1 text-foreground-subtle">
                    You can write and save drafts. Publishing is a separate permission.
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-body-sm font-medium text-white hover:bg-accent-hover"
              >
                Save post
              </button>
            </form>
          </AdminCard>
        ) : null}
      </div>
    </>
  );
}
