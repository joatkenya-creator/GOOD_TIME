import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * Reads for the phase 7 admin screens.
 *
 * One service rather than six, because these screens share a shape: a list, a
 * few counters, and a recent-activity feed. Splitting them per screen would be
 * six files of near-identical pagination.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export async function listImportJobs(limit = 50) {
  return prisma.importJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      template: { select: { name: true, sourceType: true } },
      _count: { select: { rows: true } },
    },
  });
}

export async function getImportJob(id: string) {
  return prisma.importJob.findUnique({
    where: { id },
    include: {
      template: true,
      rows: {
        // Failures and conflicts first: a successful row needs no attention,
        // and scrolling past 4,000 of them to reach the twelve that broke is
        // how an import log stops being read.
        orderBy: [{ outcome: 'asc' }, { rowNumber: 'asc' }],
        take: 200,
      },
    },
  });
}

export async function importStats() {
  const [total, completed, failed, rolledBack, rowsCreated, rowsUpdated] = await Promise.all([
    prisma.importJob.count(),
    prisma.importJob.count({ where: { status: 'COMPLETED' } }),
    prisma.importJob.count({ where: { status: { in: ['FAILED', 'PARTIAL'] } } }),
    prisma.importJob.count({ where: { status: 'ROLLED_BACK' } }),
    prisma.importRow.count({ where: { outcome: 'CREATED' } }),
    prisma.importRow.count({ where: { outcome: 'UPDATED' } }),
  ]);

  return { total, completed, failed, rolledBack, rowsCreated, rowsUpdated };
}

export async function listTemplates() {
  return prisma.importTemplate.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      createdBy: { select: { firstName: true, email: true } },
      _count: { select: { jobs: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

export async function listJobs(filter: { status?: string; kind?: string } = {}, limit = 100) {
  return prisma.backgroundJob.findMany({
    where: {
      ...(filter.status && filter.status !== 'all'
        ? { status: filter.status as 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD' | 'CANCELLED' }
        : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      kind: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      runAt: true,
      lastError: true,
      result: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      schedule: { select: { name: true } },
    },
  });
}

export async function listSchedules() {
  return prisma.scheduledJob.findMany({
    orderBy: [{ isActive: 'desc' }, { key: 'asc' }],
    include: { _count: { select: { jobs: true } } },
  });
}

/** Which job kinds exist, and how each is behaving. */
export async function jobKindStats() {
  const rows = await prisma.backgroundJob.groupBy({
    by: ['kind', 'status'],
    _count: { _all: true },
  });

  const byKind = new Map<string, Record<string, number>>();

  for (const row of rows) {
    const entry = byKind.get(row.kind) ?? {};
    entry[row.status] = row._count._all;
    byKind.set(row.kind, entry);
  }

  return [...byKind.entries()]
    .map(([kind, counts]) => ({
      kind,
      queued: counts.QUEUED ?? 0,
      running: counts.RUNNING ?? 0,
      succeeded: counts.SUCCEEDED ?? 0,
      dead: counts.DEAD ?? 0,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Search analytics
// ---------------------------------------------------------------------------

/**
 * What people searched for, and what they did not find.
 *
 * The zero-result list is the commercially valuable half: every entry is
 * demand the catalogue cannot serve, named by the customer in their own words.
 */
export async function searchAnalytics(days = 30) {
  const from = new Date(Date.now() - days * 86_400_000);

  const [popular, noResults, totals] = await Promise.all([
    prisma.searchQuery.groupBy({
      by: ['term'],
      where: { createdAt: { gte: from }, resultCount: { gt: 0 } },
      _count: { _all: true },
      _avg: { resultCount: true },
      orderBy: { _count: { term: 'desc' } },
      take: 50,
    }),

    prisma.searchQuery.groupBy({
      by: ['term'],
      where: { createdAt: { gte: from }, resultCount: 0 },
      _count: { _all: true },
      orderBy: { _count: { term: 'desc' } },
      take: 50,
    }),

    prisma.searchQuery.aggregate({
      where: { createdAt: { gte: from } },
      _count: { _all: true },
      _avg: { resultCount: true },
    }),
  ]);

  const zeroCount = noResults.reduce((sum, row) => sum + row._count._all, 0);

  return {
    popular: popular.map((row) => ({
      term: row.term,
      searches: row._count._all,
      averageResults: Math.round(row._avg.resultCount ?? 0),
    })),
    noResults: noResults.map((row) => ({ term: row.term, searches: row._count._all })),
    totalSearches: totals._count._all,
    averageResults: Math.round(totals._avg.resultCount ?? 0),
    // The headline number: what share of searches found nothing at all.
    zeroResultRate:
      totals._count._all > 0 ? Math.round((zeroCount / totals._count._all) * 1000) / 10 : 0,
  };
}

export async function listSynonyms() {
  return prisma.searchSynonym.findMany({ orderBy: { term: 'asc' } });
}

export async function searchIndexStats() {
  const [documents, products, stale] = await Promise.all([
    prisma.productSearchDocument.count(),
    prisma.product.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.productSearchDocument.count({
      where: { product: { OR: [{ status: { not: 'ACTIVE' } }, { deletedAt: { not: null } }] } },
    }),
  ]);

  return {
    documents,
    products,
    stale,
    // A gap means products exist that search cannot find, which is invisible
    // from the storefront and obvious here.
    missing: Math.max(0, products - (documents - stale)),
  };
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

export async function seoIssueSummary() {
  const [bySeverity, byCode] = await Promise.all([
    prisma.seoIssue.groupBy({
      by: ['severity'],
      where: { resolvedAt: null },
      _count: { _all: true },
    }),
    prisma.seoIssue.groupBy({
      by: ['code'],
      where: { resolvedAt: null },
      _count: { _all: true },
      orderBy: { _count: { code: 'desc' } },
      take: 15,
    }),
  ]);

  return {
    critical: bySeverity.find((row) => row.severity === 'CRITICAL')?._count._all ?? 0,
    warnings: bySeverity.find((row) => row.severity === 'WARNING')?._count._all ?? 0,
    notices: bySeverity.find((row) => row.severity === 'NOTICE')?._count._all ?? 0,
    byCode: byCode.map((row) => ({ code: row.code, count: row._count._all })),
  };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/**
 * Numbers for the performance screen.
 *
 * Everything here is measurable from inside the application. Core Web Vitals
 * are not — they are measured in the browser against real visitors, and
 * inventing them here would be exactly the fabricated-metric problem the
 * reports screen already refuses.
 */
export async function performanceSnapshot() {
  const [products, variants, media, orders, events, jobs, indexDocs] = await Promise.all([
    prisma.product.count(),
    prisma.variant.count(),
    prisma.media.aggregate({ _count: { _all: true }, _sum: { bytes: true } }),
    prisma.order.count(),
    prisma.analyticsEvent.count(),
    prisma.backgroundJob.count(),
    prisma.productSearchDocument.count(),
  ]);

  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const databaseLatencyMs = Date.now() - started;

  return {
    catalogue: { products, variants, indexDocs },
    media: { count: media._count._all, totalBytes: media._sum.bytes ?? 0 },
    rows: { orders, analyticsEvents: events, jobs },
    databaseLatencyMs,
  };
}
