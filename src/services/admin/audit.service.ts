import 'server-only';

import { headers } from 'next/headers';

import type { Prisma } from '@/generated/prisma/client';
import type { AuditAction } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * The audit trail.
 *
 * Every admin mutation writes one row. Not for compliance theatre — for the
 * Monday morning when a price is wrong, a customer is refunded twice, or four
 * hundred products are suddenly archived, and the only useful question is who
 * did it and what did it look like before.
 *
 * Three rules the rest of the admin depends on:
 *
 *   1. **Never throws.** A failed audit write must not roll back the thing it
 *      was describing. A lost log line is bad; a lost order is worse.
 *   2. **Stores the diff, not the whole record.** A full before/after snapshot
 *      of a product is mostly unchanged noise, and noise is what stops anyone
 *      reading the log.
 *   3. **Never stores secrets.** Password hashes, tokens and card data are
 *      stripped on the way in, because an audit table is the one place nobody
 *      thinks to check for them.
 */

/** Field names that must never reach the log, whatever the caller passes. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'codeHash',
  'secret',
  'twoFactorSecret',
  'cardNumber',
  'cvc',
  'clientSecret',
]);

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** Field-level diff. Build it with `diff()` rather than by hand. */
  changes?: Record<string, unknown> | null;
  actorId?: string | null;
}

/**
 * Field-level before/after, keeping only what actually changed.
 *
 * Comparing serialised forms rather than by reference so `Date` and `Decimal`
 * values do not report themselves as changed on every save — which is how an
 * audit log fills with rows that say nothing and trains everyone to ignore it.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (REDACTED_KEYS.has(key)) continue;

    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;

    changes[key] = { from: redact(from), to: redact(to) };
  }

  return changes;
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map(redact);

  if (typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(inner);
    }
    return out;
  }

  return value;
}

/**
 * Request context for the trail.
 *
 * Wrapped because `headers()` throws outside a request scope — a background
 * revalidation or a seed script. A log row without an IP is worth having; an
 * action that fails because of one is not.
 */
async function requestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return {
      ipAddress: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: list.get('user-agent'),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/** Writes one entry. Swallows its own failures by design — see the header. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const context = await requestContext();
    const changes = entry.changes && Object.keys(entry.changes).length > 0 ? entry.changes : null;

    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: changes ? (changes as unknown as Prisma.InputJsonValue) : undefined,
        ...context,
      },
    });
  } catch (error) {
    logger.error('audit.write_failed', error, {
      entityType: entry.entityType,
      entityId: entry.entityId,
    });
  }
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/** Paginated read for the audit screen and for an entity's own history tab. */
export async function listAudit(query: AuditQuery = {}) {
  const pageSize = Math.min(query.pageSize ?? 50, 200);
  const page = Math.max(1, query.page ?? 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actor: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AuditRow = Awaited<ReturnType<typeof listAudit>>['items'][number];

/**
 * Renders a diff as sentences.
 *
 * The stored shape is machine-friendly; a person scanning fifty rows needs
 * "Price: $39.00 → $34.00", not a JSON blob they have to parse in their head.
 */
export function describeChanges(changes: unknown): string[] {
  if (!changes || typeof changes !== 'object') return [];

  return Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)
    .filter(([, value]) => value && typeof value === 'object' && 'to' in value)
    .map(([field, value]) => `${humanise(field)}: ${format(value.from)} → ${format(value.to)}`);
}

function humanise(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/Cents$/, '');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
