import 'server-only';

import type { SeoIssueSeverity } from '@/generated/prisma/enums';
import type { JobContext } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The SEO health check.
 *
 * Runs against the database rather than by crawling the site. Crawling a
 * hundred thousand product pages to discover that four hundred of them have no
 * meta description takes hours and a great deal of bandwidth to learn something
 * one query already knows. What genuinely needs a fetch — do the URLs a
 * redirect points at actually resolve — is done selectively.
 *
 * Findings are graded so the list is actionable:
 *
 *   **Critical** — actively costs traffic now: a missing title, a redirect to
 *     a 404, a live product with no description.
 *   **Warning** — will cost traffic: duplicate descriptions, titles that
 *     Google will truncate, orphaned pages nothing links to.
 *   **Notice** — worth fixing when convenient.
 *
 * A checker that reports six thousand equally-weighted problems gets read once.
 */

interface Finding {
  severity: SeoIssueSeverity;
  code: string;
  url: string;
  message: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
}

/** Google truncates around here. Not a rule, but past it the tail is unread. */
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;

export async function runSeoAudit(context?: JobContext): Promise<{
  auditId: string;
  checked: number;
  critical: number;
  warnings: number;
  notices: number;
}> {
  const audit = await prisma.seoAudit.create({ data: {}, select: { id: true } });

  const findings: Finding[] = [];
  let checked = 0;

  // ------------------------------------------------------------- products
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      shortDescription: true,
      primaryCategory: { select: { path: true } },
      seo: { select: { title: true, description: true, canonicalUrl: true, noindex: true } },
      media: { take: 1, select: { mediaId: true } },
    },
  });

  checked += products.length;

  /*
   * Duplicate detection by normalised description.
   *
   * Near-identical product copy across a range — the same paragraph with the
   * colour changed — is the most common thin-content problem in a catalogue
   * fed by supplier data, and it is invisible until something counts it.
   */
  const descriptionSeen = new Map<string, string[]>();
  const titleSeen = new Map<string, string[]>();

  for (const product of products) {
    const url = `/shop/${product.primaryCategory?.path ?? ''}/${product.slug}`.replace(/\/+/g, '/');
    const title = product.seo?.title ?? product.name;
    const description = product.seo?.description ?? product.shortDescription ?? '';

    if (!title) {
      findings.push({
        severity: 'CRITICAL',
        code: 'missing_title',
        url,
        message: 'No title.',
        entityType: 'Product',
        entityId: product.id,
      });
    } else if (title.length > TITLE_MAX) {
      findings.push({
        severity: 'NOTICE',
        code: 'title_too_long',
        url,
        message: `Title is ${title.length} characters; search results cut off around ${TITLE_MAX}.`,
        detail: title,
        entityType: 'Product',
        entityId: product.id,
      });
    }

    if (!description) {
      findings.push({
        severity: 'CRITICAL',
        code: 'missing_description',
        url,
        message: 'No meta description, so Google will invent one from the page.',
        entityType: 'Product',
        entityId: product.id,
      });
    } else if (description.length < DESCRIPTION_MIN) {
      findings.push({
        severity: 'WARNING',
        code: 'description_too_short',
        url,
        message: `Description is ${description.length} characters; under ${DESCRIPTION_MIN} rarely fills the snippet.`,
        detail: description,
        entityType: 'Product',
        entityId: product.id,
      });
    } else if (description.length > DESCRIPTION_MAX) {
      findings.push({
        severity: 'NOTICE',
        code: 'description_too_long',
        url,
        message: `Description is ${description.length} characters; truncated around ${DESCRIPTION_MAX}.`,
        entityType: 'Product',
        entityId: product.id,
      });
    }

    if (!product.description || product.description.length < 200) {
      findings.push({
        severity: 'WARNING',
        code: 'thin_content',
        url,
        message: 'The product body is very short, which reads as thin content.',
        entityType: 'Product',
        entityId: product.id,
      });
    }

    if (product.media.length === 0) {
      findings.push({
        severity: 'WARNING',
        code: 'no_image',
        url,
        message: 'No image, so this cannot appear in image search or a shopping feed.',
        entityType: 'Product',
        entityId: product.id,
      });
    }

    if (product.seo?.noindex) {
      findings.push({
        severity: 'WARNING',
        code: 'noindex_live_product',
        url,
        message: 'A live product marked noindex. Deliberate, or left over from a draft?',
        entityType: 'Product',
        entityId: product.id,
      });
    }

    const normalisedDescription = description.trim().toLowerCase().slice(0, 200);
    if (normalisedDescription.length > 40) {
      const bucket = descriptionSeen.get(normalisedDescription) ?? [];
      bucket.push(url);
      descriptionSeen.set(normalisedDescription, bucket);
    }

    const normalisedTitle = title.trim().toLowerCase();
    const titleBucket = titleSeen.get(normalisedTitle) ?? [];
    titleBucket.push(url);
    titleSeen.set(normalisedTitle, titleBucket);
  }

  for (const [, urls] of descriptionSeen) {
    if (urls.length < 2) continue;
    findings.push({
      severity: 'WARNING',
      code: 'duplicate_description',
      url: urls[0]!,
      message: `${urls.length} pages share this meta description.`,
      detail: urls.slice(0, 8).join(', '),
    });
  }

  for (const [, urls] of titleSeen) {
    if (urls.length < 2) continue;
    findings.push({
      severity: 'WARNING',
      code: 'duplicate_title',
      url: urls[0]!,
      message: `${urls.length} pages share this title.`,
      detail: urls.slice(0, 8).join(', '),
    });
  }

  await context?.progress(checked);

  // ----------------------------------------------------------- categories
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      path: true,
      name: true,
      description: true,
      seo: { select: { title: true, description: true } },
      _count: { select: { products: true } },
    },
  });

  checked += categories.length;

  for (const category of categories) {
    const url = `/shop/${category.path}`.replace(/\/+/g, '/');

    if (!category.seo?.description && !category.description) {
      findings.push({
        severity: 'WARNING',
        code: 'missing_description',
        url,
        message: 'Category has no description.',
        entityType: 'Category',
        entityId: category.id,
      });
    }

    if (category._count.products === 0) {
      findings.push({
        severity: 'CRITICAL',
        code: 'empty_category',
        url,
        message: 'A live category with no products — a soft 404 that wastes crawl budget.',
        entityType: 'Category',
        entityId: category.id,
      });
    }
  }

  // ------------------------------------------------------------ redirects
  const redirects = await prisma.redirect.findMany({
    where: { isActive: true },
    select: { id: true, source: true, destination: true },
  });

  checked += redirects.length;

  const redirectSources = new Set(redirects.map((redirect) => redirect.source));

  for (const redirect of redirects) {
    // A redirect whose destination is itself a redirect source is a chain:
    // each hop loses signal, and a cycle is a crawl trap.
    if (redirectSources.has(redirect.destination)) {
      findings.push({
        severity: 'CRITICAL',
        code: 'redirect_chain',
        url: redirect.source,
        message: `Redirects to ${redirect.destination}, which itself redirects.`,
        entityType: 'Redirect',
        entityId: redirect.id,
      });
    }
  }

  // ---------------------------------------------------------------- posts
  const posts = await prisma.post.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, slug: true, title: true, excerpt: true, content: true },
  });

  checked += posts.length;

  for (const post of posts) {
    const url = `/guides/${post.slug}`;

    if (!post.excerpt) {
      findings.push({
        severity: 'WARNING',
        code: 'missing_description',
        url,
        message: 'No excerpt, so there is no meta description.',
        entityType: 'Post',
        entityId: post.id,
      });
    }

    if (post.content.length < 600) {
      findings.push({
        severity: 'NOTICE',
        code: 'thin_content',
        url,
        message: 'Short article; long-form guides are what rank in this category.',
        entityType: 'Post',
        entityId: post.id,
      });
    }
  }

  // --------------------------------------------------------------- orphans
  /*
   * Products in no collection and no secondary category.
   *
   * Internal links are how crawl depth and authority flow. A product reachable
   * only from a paginated listing thirty pages deep is one Google may never
   * bother with.
   */
  const orphans = await prisma.product.count({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      collections: { none: {} },
      categories: { none: {} },
    },
  });

  if (orphans > 0) {
    findings.push({
      severity: 'WARNING',
      code: 'orphan_products',
      url: '/shop',
      message: `${orphans} live products are in no collection and no secondary category, so almost nothing links to them.`,
    });
  }

  // ---------------------------------------------------------------- write
  const counts = {
    critical: findings.filter((finding) => finding.severity === 'CRITICAL').length,
    warnings: findings.filter((finding) => finding.severity === 'WARNING').length,
    notices: findings.filter((finding) => finding.severity === 'NOTICE').length,
  };

  if (findings.length > 0) {
    await prisma.seoIssue.createMany({
      // Capped: an audit that writes fifty thousand rows makes the next audit
      // slower and the list no more useful.
      data: findings.slice(0, 5000).map((finding) => ({ auditId: audit.id, ...finding })),
    });
  }

  await prisma.seoAudit.update({
    where: { id: audit.id },
    data: {
      finishedAt: new Date(),
      checked,
      critical: counts.critical,
      warnings: counts.warnings,
      notices: counts.notices,
      summary: {
        products: products.length,
        categories: categories.length,
        posts: posts.length,
        redirects: redirects.length,
        orphans,
      },
    },
  });

  logger.info('seo.audited', { auditId: audit.id, checked, ...counts });

  return { auditId: audit.id, checked, ...counts };
}

/** The most recent audit, for the SEO dashboard. */
export async function latestAudit() {
  return prisma.seoAudit.findFirst({
    orderBy: { startedAt: 'desc' },
    include: {
      issues: {
        where: { resolvedAt: null },
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      },
    },
  });
}

/**
 * Checks that internal links resolve.
 *
 * Fetches rather than inspects, because a link can be well-formed and still
 * dead. Bounded and slow on purpose — this is a background job, and hammering
 * our own origin to check ourselves would be a self-inflicted load test.
 */
export async function checkLinks(
  urls: string[],
  baseUrl: string,
  limit = 50,
): Promise<{ url: string; status: number }[]> {
  const broken: { url: string; status: number }[] = [];

  for (const url of urls.slice(0, limit)) {
    try {
      const response = await fetch(new URL(url, baseUrl), {
        method: 'HEAD',
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      });

      if (response.status >= 400) broken.push({ url, status: response.status });
    } catch {
      broken.push({ url, status: 0 });
    }
  }

  return broken;
}
