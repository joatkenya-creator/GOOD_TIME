import { PERMISSIONS } from '@/constants/permissions';
import { pageQuerySchema } from '@/lib/api/pagination';
import { errors, readQuery, withRoute } from '@/lib/api/handler';
import { assertPermission } from '@/server/auth/session';

/**
 * `/api/admin/products` — back-office catalogue management.
 *
 * Every admin route asserts a specific capability rather than "is an admin", so
 * a future Merchandiser role can be granted `product:write` without also getting
 * refunds and customer data.
 *
 * Mutations here must also write an `AuditLog` row: who changed what, and when.
 */
export const GET = withRoute(async ({ request }) => {
  await assertPermission(PERMISSIONS.productRead);
  const query = readQuery(request, pageQuerySchema);
  void query;

  throw errors.notImplemented('Admin product listing');
});

export const POST = withRoute(async () => {
  await assertPermission(PERMISSIONS.productWrite);

  throw errors.notImplemented('Product creation');
});
