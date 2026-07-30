import { pageQuerySchema } from '@/lib/api/pagination';
import { errors, readQuery, withRoute } from '@/lib/api/handler';
import { assertUser } from '@/server/auth/session';

/**
 * `GET /api/orders` — the signed-in customer's order history.
 *
 * Scoped to `userId` from the session, never from a query parameter. An
 * `?userId=` filter here would be an IDOR waiting to happen.
 */
export const GET = withRoute(async ({ request }) => {
  const user = await assertUser();
  const query = readQuery(request, pageQuerySchema);
  void user;
  void query;

  throw errors.notImplemented('Order history');
});
