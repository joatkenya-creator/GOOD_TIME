import { z } from 'zod';

import { readQuery, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { getProductsByIds } from '@/services/product.service';

/**
 * `GET /api/products/lookup?ids=a,b,c`
 *
 * Hydrates an arbitrary id list into listing cards. Backs the browser-local
 * wishlist, compare and recently-viewed lists, which know ids but not content.
 *
 * Response order matches the requested order — recency order is the entire point
 * of the recently-viewed rail.
 */
const querySchema = z.object({
  ids: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1)).max(50)),
});

export const GET = withRoute(
  async ({ request }) => {
    const { ids } = readQuery(request, querySchema);
    const products = await getProductsByIds(ids);

    return jsonOk(products, {
      // Per-visitor id list, but the product data itself is public and stable.
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    });
  },
  { rateLimit: { bucket: 'catalogue', limit: 240, windowSeconds: 60 } },
);
