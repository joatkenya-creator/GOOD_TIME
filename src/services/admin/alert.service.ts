import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { AdminAlertLevel } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/server/auth/session';
import type { Permission } from '@/constants/permissions';

/**
 * Operational alerts for whoever is on shift.
 *
 * Addressed by permission rather than by person: routing "low stock" to a named
 * manager means it goes unread the week they are on holiday. Staff see the
 * alerts their permissions imply they can act on, which is also why an alert
 * carries the permission rather than a role — the same reasoning as everywhere
 * else in this codebase.
 */

export interface RaiseAlertInput {
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  level?: AdminAlertLevel;
  permission?: Permission | null;
  /**
   * Collapses repeats. The fortieth low-stock alert for the same variant is
   * noise, and an inbox nobody can clear is an inbox nobody reads.
   */
  dedupeKey?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Raises an alert, or quietly does nothing if one with the same key is already
 * unread.
 *
 * Never throws: an alert is a notification about work, not the work. Failing a
 * checkout because its "new order" alert could not be written would be an
 * absurd trade.
 */
export async function raiseAlert(input: RaiseAlertInput): Promise<void> {
  try {
    if (input.dedupeKey) {
      const existing = await prisma.adminAlert.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true, readAt: true },
      });

      // Still unread: the reader has not dealt with it, so saying it again
      // helps nobody.
      if (existing && !existing.readAt) return;

      // Read and now recurring: replace it, so the new one surfaces.
      if (existing) await prisma.adminAlert.delete({ where: { id: existing.id } });
    }

    await prisma.adminAlert.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        level: input.level ?? 'INFO',
        permission: input.permission ?? null,
        dedupeKey: input.dedupeKey ?? null,
        data: input.data ? (input.data as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (error) {
    logger.error('alert.raise_failed', error, { type: input.type });
  }
}

/** Alerts this user is allowed to see: unrestricted ones, plus ones they can act on. */
function visibilityFilter(user: SessionUser): Prisma.AdminAlertWhereInput {
  return {
    OR: [
      { permission: null },
      { permission: { in: user.permissions as string[] } },
    ],
  };
}

export async function countUnreadAlerts(user: SessionUser): Promise<number> {
  return prisma.adminAlert.count({
    where: { readAt: null, ...visibilityFilter(user) },
  });
}

export async function listAlerts(
  user: SessionUser,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  return prisma.adminAlert.findMany({
    where: {
      ...visibilityFilter(user),
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: Math.min(options.limit ?? 50, 200),
    include: { readBy: { select: { firstName: true, email: true } } },
  });
}

export type AlertRow = Awaited<ReturnType<typeof listAlerts>>[number];

/**
 * Marks one alert read.
 *
 * Scoped by the same visibility filter as the read path, so a request naming
 * an id the user cannot see changes nothing — an id in a URL is a guess, not
 * an authorisation.
 */
export async function markAlertRead(user: SessionUser, alertId: string): Promise<void> {
  await prisma.adminAlert.updateMany({
    where: { id: alertId, readAt: null, ...visibilityFilter(user) },
    data: { readAt: new Date(), readById: user.id },
  });
}

export async function markAllAlertsRead(user: SessionUser): Promise<number> {
  const result = await prisma.adminAlert.updateMany({
    where: { readAt: null, ...visibilityFilter(user) },
    data: { readAt: new Date(), readById: user.id },
  });
  return result.count;
}

/**
 * Re-derives stock alerts from current inventory.
 *
 * Called from the dashboard rather than from a background job: this phase does
 * not own the scheduler, and a low-stock warning nobody has looked at yet is
 * not urgent. The dedupe key keeps it idempotent however often it runs.
 */
export async function syncInventoryAlerts(): Promise<{ low: number; out: number }> {
  const rows = await prisma.inventory.findMany({
    where: { policy: 'DENY' },
    select: {
      quantity: true,
      reserved: true,
      lowStockThreshold: true,
      variant: {
        select: { id: true, sku: true, name: true, product: { select: { name: true, slug: true } } },
      },
    },
    take: 500,
  });

  let low = 0;
  let out = 0;

  for (const row of rows) {
    const available = row.quantity - row.reserved;
    if (available > row.lowStockThreshold) continue;

    const label = `${row.variant.product.name} — ${row.variant.name}`;
    const isOut = available <= 0;
    if (isOut) out += 1;
    else low += 1;

    await raiseAlert({
      type: isOut ? 'inventory.out' : 'inventory.low',
      level: isOut ? 'CRITICAL' : 'WARNING',
      title: isOut ? `Out of stock: ${label}` : `Low stock: ${label}`,
      body: isOut
        ? `${row.variant.sku} cannot be sold — the policy denies backorder.`
        : `${available} left of ${row.variant.sku}, threshold is ${row.lowStockThreshold}.`,
      href: `/admin/inventory?q=${encodeURIComponent(row.variant.sku)}`,
      permission: 'inventory:read',
      // Keyed by state as well as variant, so an item falling from low to zero
      // raises a fresh alert rather than hiding behind the earlier one.
      dedupeKey: `inventory:${isOut ? 'out' : 'low'}:${row.variant.id}`,
      data: { variantId: row.variant.id, available },
    });
  }

  return { low, out };
}
