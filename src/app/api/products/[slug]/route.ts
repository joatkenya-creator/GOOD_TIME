import { productSlugSchema } from '@/features/catalog/schemas';
import { errors, withRoute } from '@/lib/api/handler';

/**
 * `GET /api/products/[slug]` — one product with variants, media and live stock.
 *
 * Implementation notes:
 *   - single query with `include`, not a query per relation;
 *   - inventory is read live (never from the persistent cache) so the buy button
 *     cannot offer something that sold out ten minutes ago;
 *   - 404 for `DRAFT`/`ARCHIVED` products, so unpublished SKUs are not
 *     discoverable by guessing slugs.
 */
export const GET = withRoute<{ slug: string }>(
  async ({ params }) => {
    const { slug } = productSlugSchema.parse(params);
    void slug;

    throw errors.notImplemented('Product detail');
  },
  { rateLimit: { bucket: 'catalogue', limit: 240, windowSeconds: 60 } },
);
