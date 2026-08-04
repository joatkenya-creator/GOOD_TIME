'use server';

import { revalidatePath } from 'next/cache';

import { PERMISSIONS } from '@/constants/permissions';
import type { ImportSourceType, MarketingProvider } from '@/generated/prisma/enums';
import { enqueue, requeue, cancel } from '@/lib/jobs/queue';
import { isValidCron, nextRun } from '@/lib/jobs/cron';
import { prisma } from '@/lib/prisma';
import { checkFeedUrl } from '@/lib/security/uploads';
import { withAdminAction } from '@/server/auth/admin';
import { rollbackImport } from '@/services/import/runner';
import { saveIntegration } from '@/services/marketing/integrations';

/**
 * Phase 7 admin actions.
 *
 * All of them route through `withAdminAction`, so each is permission-checked
 * and audited by construction — the same guarantee phase 6 established, and
 * one these actions need more than most: an import touches thousands of
 * products, and a rollback touches them again.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

/**
 * Queues an import.
 *
 * Never runs it inline. A 50,000-row feed takes minutes; doing that in a
 * request means a browser timeout, a half-applied import and no record of
 * where it stopped. The job id comes back immediately and the admin watches
 * progress.
 */
export async function startImportAction(formData: FormData): Promise<void> {
  const templateId = String(formData.get('templateId') ?? '');
  const sourceName = String(formData.get('sourceName') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim();
  const isDryRun = formData.get('isDryRun') === 'on';
  const conflictPolicy = String(formData.get('conflictPolicy') ?? 'overwrite');

  if (!templateId || !sourceName) return;

  if (url) {
    const verdict = checkFeedUrl(url);
    if (!verdict.ok) throw new Error(verdict.reason ?? 'That feed URL is not allowed.');
  }

  await withAdminAction(
    PERMISSIONS.importRun,
    async (actor) => {
      const template = await prisma.importTemplate.findUniqueOrThrow({
        where: { id: templateId },
        select: { sourceType: true, config: true },
      });

      const job = await prisma.importJob.create({
        data: {
          sourceType: template.sourceType,
          sourceName,
          templateId,
          createdById: actor.id,
          isDryRun,
          config: {
            ...(template.config as Record<string, unknown>),
            ...(url ? { url } : {}),
            conflictPolicy,
          },
        },
        select: { id: true },
      });

      await enqueue({
        kind: 'import.run',
        payload: { importJobId: job.id },
        // Ahead of routine maintenance: someone is watching this one.
        priority: 20,
        maxAttempts: 2,
      });

      return job;
    },
    (result) => ({
      action: 'IMPORT' as const,
      entityType: 'ImportJob',
      entityId: result.id,
      changes: {
        source: { from: null, to: sourceName },
        dryRun: { from: null, to: isDryRun },
      },
    }),
  );

  revalidatePath('/admin/imports');
}

export async function rollbackImportAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '');
  if (!jobId) return;

  await withAdminAction(
    PERMISSIONS.importRollback,
    (actor) => rollbackImport(jobId, actor.id),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'ImportJob',
      entityId: jobId,
      changes: {
        archived: { from: null, to: result.archived },
        restored: { from: null, to: result.restored },
      },
    }),
  );

  revalidatePath('/admin/imports');
}

export async function saveTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '') || undefined;
  const name = String(formData.get('name') ?? '').trim();
  const sourceType = String(formData.get('sourceType') ?? 'CSV') as ImportSourceType;
  const url = String(formData.get('url') ?? '').trim();

  if (!name) return;

  if (url) {
    const verdict = checkFeedUrl(url);
    if (!verdict.ok) throw new Error(verdict.reason ?? 'That feed URL is not allowed.');
  }

  /*
   * The mapping arrives as `map.<ourField>` form fields.
   *
   * A flat form rather than a JSON blob in a textarea: the admin builds this
   * from the file's own column list, and a mapping someone hand-writes as JSON
   * is a mapping with a typo in it.
   */
  const mapping: Record<string, { from: string; transform?: string }> = {};

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('map.') || !String(value)) continue;

    const field = key.slice(4);
    const transform = String(formData.get(`transform.${field}`) ?? '');

    mapping[field] = transform ? { from: String(value), transform } : { from: String(value) };
  }

  await withAdminAction(
    PERMISSIONS.importTemplateManage,
    async (actor) => {
      const data = {
        name,
        sourceType,
        mapping: mapping as never,
        config: (url ? { url } : {}) as never,
        isActive: formData.get('isActive') !== 'off',
        createdById: actor.id,
      };

      return id
        ? prisma.importTemplate.update({ where: { id }, data, select: { id: true, name: true } })
        : prisma.importTemplate.create({ data, select: { id: true, name: true } });
    },
    (result) => ({
      action: id ? ('UPDATE' as const) : ('CREATE' as const),
      entityType: 'ImportTemplate',
      entityId: result.id,
      changes: { name: { from: null, to: result.name } },
    }),
  );

  revalidatePath('/admin/imports/templates');
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

export async function requeueJobAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '');
  if (!jobId) return;

  await withAdminAction(
    PERMISSIONS.jobsManage,
    () => requeue(jobId),
    () => ({ action: 'UPDATE' as const, entityType: 'BackgroundJob', entityId: jobId }),
  );

  revalidatePath('/admin/jobs');
}

export async function cancelJobAction(formData: FormData): Promise<void> {
  const jobId = String(formData.get('jobId') ?? '');
  if (!jobId) return;

  await withAdminAction(
    PERMISSIONS.jobsManage,
    () => cancel(jobId),
    () => ({ action: 'UPDATE' as const, entityType: 'BackgroundJob', entityId: jobId }),
  );

  revalidatePath('/admin/jobs');
}

/** Runs a scheduled job now, without disturbing its schedule. */
export async function runNowAction(formData: FormData): Promise<void> {
  const kind = String(formData.get('kind') ?? '');
  if (!kind) return;

  await withAdminAction(
    PERMISSIONS.jobsManage,
    () =>
      enqueue({
        kind,
        priority: 10,
        // No dedupe key: "run it now" means now, even if one is already queued.
      }),
    (result) => ({
      action: 'CREATE' as const,
      entityType: 'BackgroundJob',
      entityId: result.id,
      changes: { kind: { from: null, to: kind } },
    }),
  );

  revalidatePath('/admin/jobs');
}

export async function saveScheduleAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const cron = String(formData.get('cron') ?? '').trim();
  const isActive = formData.get('isActive') === 'on';

  if (!id || !isValidCron(cron)) {
    throw new Error(`"${cron}" is not a valid five-field cron expression.`);
  }

  await withAdminAction(
    PERMISSIONS.jobsManage,
    () =>
      prisma.scheduledJob.update({
        where: { id },
        data: {
          cron,
          isActive,
          // Recomputed so the change takes effect at the next tick rather than
          // waiting for the old schedule to fire once more.
          nextRunAt: isActive ? nextRun(cron) : null,
        },
        select: { id: true, key: true },
      }),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'ScheduledJob',
      entityId: result.id,
      changes: { cron: { from: null, to: cron }, active: { from: null, to: isActive } },
    }),
  );

  revalidatePath('/admin/jobs');
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function reindexAction(): Promise<void> {
  await withAdminAction(
    PERMISSIONS.searchManage,
    () =>
      enqueue({
        kind: 'search.reindex_all',
        priority: 30,
        dedupeKey: 'search.reindex_all',
      }),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'SearchIndex',
      entityId: result.id,
    }),
  );

  revalidatePath('/admin/search');
}

export async function saveSynonymAction(formData: FormData): Promise<void> {
  const term = String(formData.get('term') ?? '').trim().toLowerCase();
  const synonyms = String(formData.get('synonyms') ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!term || synonyms.length === 0) return;

  await withAdminAction(
    PERMISSIONS.searchManage,
    async () => {
      const row = await prisma.searchSynonym.upsert({
        where: { term },
        update: { synonyms, isOneWay: formData.get('isOneWay') === 'on', isActive: true },
        create: {
          term,
          synonyms,
          isOneWay: formData.get('isOneWay') === 'on',
        },
        select: { id: true, term: true },
      });

      // The synonym table is cached on the search path; a merchandiser who
      // adds one expects the next search to use it.
      const { invalidate } = await import('@/lib/cache/store');
      await invalidate('search');

      return row;
    },
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'SearchSynonym',
      entityId: result.id,
      changes: { term: { from: null, to: result.term }, synonyms: { from: null, to: synonyms } },
    }),
  );

  revalidatePath('/admin/search');
}

export async function deleteSynonymAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await withAdminAction(
    PERMISSIONS.searchManage,
    async () => {
      await prisma.searchSynonym.delete({ where: { id } });
      const { invalidate } = await import('@/lib/cache/store');
      await invalidate('search');
    },
    () => ({ action: 'DELETE' as const, entityType: 'SearchSynonym', entityId: id }),
  );

  revalidatePath('/admin/search');
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

export async function runSeoAuditAction(): Promise<void> {
  await withAdminAction(
    PERMISSIONS.seoWrite,
    () => enqueue({ kind: 'seo.audit', priority: 40, dedupeKey: 'seo.audit' }),
    (result) => ({ action: 'CREATE' as const, entityType: 'SeoAudit', entityId: result.id }),
  );

  revalidatePath('/admin/seo');
}

export async function resolveIssueAction(formData: FormData): Promise<void> {
  const issueId = String(formData.get('issueId') ?? '');
  if (!issueId) return;

  await withAdminAction(
    PERMISSIONS.seoWrite,
    () =>
      prisma.seoIssue.update({
        where: { id: issueId },
        data: { resolvedAt: new Date() },
        select: { id: true, code: true },
      }),
    (result) => ({
      action: 'UPDATE' as const,
      entityType: 'SeoIssue',
      entityId: result.id,
      changes: { resolved: { from: null, to: result.code } },
    }),
  );

  revalidatePath('/admin/seo');
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export async function saveIntegrationAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '') as MarketingProvider;
  if (!provider) return;

  const isEnabled = formData.get('isEnabled') === 'on';
  const publicId = String(formData.get('publicId') ?? '').trim() || null;

  await withAdminAction(
    PERMISSIONS.marketingManage,
    (actor) =>
      saveIntegration({
        provider,
        isEnabled,
        publicId,
        /*
         * Consent stays on unless someone deliberately turns it off, and the
         * form has to send `off` to do it. A pixel that silently defaults to
         * "no consent needed" is the exact failure this whole module exists to
         * prevent.
         */
        requiresConsent: formData.get('requiresConsent') !== 'off',
        notes: String(formData.get('notes') ?? '') || null,
        updatedById: actor.id,
      }),
    () => ({
      action: 'UPDATE' as const,
      entityType: 'MarketingIntegration',
      entityId: provider,
      changes: {
        enabled: { from: null, to: isEnabled },
        // The id is public by design, but recording it makes "who turned this
        // on and with what" answerable.
        publicId: { from: null, to: publicId },
      },
    }),
  );

  revalidatePath('/admin/marketing');
  revalidatePath('/', 'layout');
}
