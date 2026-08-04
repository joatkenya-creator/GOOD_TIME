import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

/**
 * Orders, customers and promotions.
 *
 * Read and light-write paths for the commerce modules. Anything that moves
 * money — refunds, transitions, credit — stays in the phase-4 and phase-5
 * services, which already own the invariants. Re-implementing a refund here so
 * the admin could have its own would be two refunds that drift.
 */

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderListQuery {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listAdminOrders(query: OrderListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 10), 100);

  const where: Prisma.OrderWhereInput = {
    ...(query.q
      ? {
          OR: [
            { orderNumber: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.status && query.status !== 'all' ? { status: query.status as OrderStatus } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNumber: true,
        email: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        totalCents: true,
        riskFlags: true,
        createdAt: true,
        placedAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AdminOrderRow = Awaited<ReturnType<typeof listAdminOrders>>['items'][number];

export async function getOrderCounts() {
  const rows = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  return {
    all: rows.reduce((sum, row) => sum + row._count._all, 0),
    ...counts,
  } as Record<string, number>;
}

/** Everything the order detail screen shows, in one query. */
export async function getAdminOrder(orderNumber: string) {
  return prisma.order.findUnique({
    where: { orderNumber },
    include: {
      items: true,
      payments: { orderBy: { createdAt: 'desc' } },
      shipments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'desc' } },
      staffNotes: {
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        include: { author: { select: { firstName: true, email: true } } },
      },
      returnRequests: { include: { items: true } },
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      coupon: { select: { code: true } },
    },
  });
}

export type AdminOrder = NonNullable<Awaited<ReturnType<typeof getAdminOrder>>>;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerListQuery {
  q?: string;
  status?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The customer list, with lifetime value.
 *
 * LTV is aggregated in the same query rather than computed per row: a list of
 * fifty customers each triggering their own `SUM(orders)` is fifty round trips
 * to render one screen.
 */
export async function listCustomers(query: CustomerListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 10), 100);

  const where: Prisma.UserWhereInput = {
    ...(query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { firstName: { contains: query.q, mode: 'insensitive' } },
            { lastName: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.status && query.status !== 'all'
      ? { status: query.status as Prisma.EnumUserStatusFilter['equals'] }
      : {}),
    ...(query.tag ? { adminTags: { has: query.tag } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        adminTags: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { orders: true } },
        rewardAccount: { select: { tier: true, pointsBalance: true, storeCreditCents: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const spend = await prisma.order.groupBy({
    by: ['userId'],
    where: {
      userId: { in: rows.map((row) => row.id) },
      status: { in: ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
    },
    _sum: { totalCents: true },
  });

  const byUser = new Map(spend.map((row) => [row.userId, row._sum.totalCents ?? 0]));

  return {
    items: rows.map((row) => ({ ...row, lifetimeValueCents: byUser.get(row.id) ?? 0 })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type AdminCustomerRow = Awaited<ReturnType<typeof listCustomers>>['items'][number];

export async function getAdminCustomer(id: string) {
  const [user, orders, spend] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: {
        addresses: true,
        preferences: true,
        rewardAccount: true,
        roles: { include: { role: { select: { key: true, name: true } } } },
        staffNotesAbout: {
          orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
          include: { author: { select: { firstName: true, email: true } } },
        },
        wishlists: { include: { _count: { select: { items: true } } } },
        notificationPreferences: true,
      },
    }),
    prisma.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalCents: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.order.aggregate({
      where: {
        userId: id,
        status: { in: ['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      },
      _sum: { totalCents: true },
      _count: { _all: true },
    }),
  ]);

  if (!user) return null;

  return {
    user,
    orders,
    lifetimeValueCents: spend._sum.totalCents ?? 0,
    paidOrderCount: spend._count._all,
    averageOrderCents:
      spend._count._all > 0 ? Math.round((spend._sum.totalCents ?? 0) / spend._count._all) : 0,
  };
}

/** Staff-applied labels, replacing the set rather than diffing it. */
export async function setCustomerTags(userId: string, tags: string[]): Promise<void> {
  const cleaned = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  await prisma.user.update({ where: { id: userId }, data: { adminTags: cleaned } });
}

export async function addStaffNote(input: {
  userId?: string | null;
  orderId?: string | null;
  authorId: string;
  body: string;
  isPinned?: boolean;
}) {
  return prisma.staffNote.create({
    data: {
      userId: input.userId ?? null,
      orderId: input.orderId ?? null,
      authorId: input.authorId,
      body: input.body.trim(),
      isPinned: input.isPinned ?? false,
    },
  });
}

/** Every tag in use, for the filter dropdown. */
export async function listCustomerTags(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { adminTags: { isEmpty: false } },
    select: { adminTags: true },
    take: 1000,
  });

  return [...new Set(rows.flatMap((row) => row.adminTags))].sort();
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export async function listCoupons(query: { q?: string; status?: string } = {}) {
  const now = new Date();
  const stamp = now.getTime();

  const where: Prisma.CouponWhereInput = {
    ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(query.status === 'active' ? { isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } : {}),
    ...(query.status === 'expired' ? { endsAt: { lt: now } } : {}),
    ...(query.status === 'disabled' ? { isActive: false } : {}),
  };

  const rows = await prisma.coupon.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { _count: { select: { redemptions: true } } },
  });

  // Expired / exhausted decided here, for the same reason as collections: it
  // is a fact about the row, not something render should read a clock for.
  return rows.map((coupon) => ({
    ...coupon,
    state: (!coupon.isActive
      ? 'disabled'
      : coupon.endsAt && coupon.endsAt.getTime() < stamp
        ? 'expired'
        : coupon.usageLimit !== null && coupon._count.redemptions >= coupon.usageLimit
          ? 'exhausted'
          : 'active') as 'disabled' | 'expired' | 'exhausted' | 'active',
  }));
}

export type AdminCouponRow = Awaited<ReturnType<typeof listCoupons>>[number];

export async function listGiftCards() {
  return prisma.giftCard.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { issuedBy: { select: { firstName: true, email: true } } },
  });
}

export async function listReferralCodes() {
  return prisma.referralCode.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { email: true, firstName: true } } },
  });
}
