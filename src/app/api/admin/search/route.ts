import { PERMISSIONS } from '@/constants/permissions';
import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { prisma } from '@/lib/prisma';
import { assertAdminPermission, maskEmail } from '@/server/auth/admin';
import { can } from '@/server/auth/session';

/**
 * Global admin search, behind the command palette.
 *
 * Each record type is searched only if the caller can read it, so the results
 * are a view of what this person is allowed to see rather than a filtered copy
 * of everything. Searching first and filtering after would leak existence
 * through result counts — and through timing, for anyone paying attention.
 */
export const GET = withRoute(async ({ request }) => {
  const user = await assertAdminPermission(PERMISSIONS.productRead);

  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return jsonOk([]);

  const term = query.slice(0, 80);
  const seePii = can(user, PERMISSIONS.customerPii);

  const [products, orders, customers] = await Promise.all([
    can(user, PERMISSIONS.productRead)
      ? prisma.product.findMany({
          where: {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { sku: { contains: term, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true, sku: true, status: true },
          take: 5,
        })
      : [],

    can(user, PERMISSIONS.orderRead)
      ? prisma.order.findMany({
          where: {
            OR: [
              { orderNumber: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
            ],
          },
          select: { id: true, orderNumber: true, email: true, totalCents: true, status: true },
          take: 5,
        })
      : [],

    can(user, PERMISSIONS.customerRead)
      ? prisma.user.findMany({
          where: {
            OR: [
              { email: { contains: term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          },
          select: { id: true, email: true, firstName: true, lastName: true },
          take: 5,
        })
      : [],
  ]);

  const hits = [
    ...products.map((product) => ({
      id: product.id,
      type: 'product' as const,
      title: product.name,
      subtitle: `${product.sku ?? 'No SKU'} · ${product.status.toLowerCase()}`,
      href: `/admin/products/${product.id}`,
    })),
    ...orders.map((order) => ({
      id: order.id,
      type: 'order' as const,
      title: order.orderNumber,
      subtitle: `${maskEmail(order.email, seePii)} · $${(order.totalCents / 100).toFixed(2)}`,
      href: `/admin/orders/${order.orderNumber}`,
    })),
    ...customers.map((customer) => ({
      id: customer.id,
      type: 'customer' as const,
      title:
        [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
        maskEmail(customer.email, seePii),
      subtitle: maskEmail(customer.email, seePii),
      href: `/admin/customers/${customer.id}`,
    })),
  ];

  // Never cached: results depend on who is asking.
  return jsonOk(hits, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const dynamic = 'force-dynamic';
