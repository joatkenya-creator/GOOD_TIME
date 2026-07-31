import { buildPaginationMeta, pageQuerySchema, toSkipTake } from '@/lib/api/pagination';
import { readQuery, withRoute } from '@/lib/api/handler';
import { jsonPaginated } from '@/lib/api/response';
import { prisma } from '@/lib/prisma';
import { assertUser } from '@/server/auth/session';
import { getOrdersForUser } from '@/services/order.service';

/**
 * `GET /api/orders` — the signed-in customer's order history.
 *
 * Scoped to `userId` from the session, never from a query parameter. An
 * `?userId=` filter here would be an IDOR waiting to happen.
 */
export const GET = withRoute(async ({ request }) => {
  const user = await assertUser();
  const query = readQuery(request, pageQuerySchema);
  const { skip, take } = toSkipTake(query);

  const [orders, total] = await Promise.all([
    getOrdersForUser(user.id, take, skip),
    prisma.order.count({ where: { userId: user.id } }),
  ]);

  return jsonPaginated(orders, buildPaginationMeta(query, total));
});

export const dynamic = 'force-dynamic';
