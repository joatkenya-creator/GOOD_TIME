import { productSlugSchema } from '@/features/catalog/schemas';
import { errors, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { cacheControl } from '@/lib/cache/cached';
import { resolvePrice, stockStatus } from '@/features/catalog/pricing';
import { getProductBySlug, getRelatedProducts, productHref } from '@/services/product.service';
import { getRatingSummary } from '@/services/review.service';

/**
 * `GET /api/products/[slug]` — one product with variants, media and live stock.
 *
 * Inventory is read live and never served from the persistent cache, so the
 * response cannot offer something that sold out ten minutes ago. `DRAFT` and
 * `ARCHIVED` products 404 rather than 403, so unpublished SKUs are not
 * discoverable by guessing slugs.
 */
export const GET = withRoute<{ slug: string }>(
  async ({ params }) => {
    const { slug } = productSlugSchema.parse(params);

    const product = await getProductBySlug(slug);
    if (!product) throw errors.notFound('Product');

    const [summary, related] = await Promise.all([
      getRatingSummary(product.id),
      getRelatedProducts(product.id, 'RELATED', 6),
    ]);

    return jsonOk(
      {
        id: product.id,
        slug: product.slug,
        name: product.name,
        shortDescription: product.shortDescription,
        description: product.description,
        href: productHref(product.primaryCategory?.path, product.slug),
        currency: product.currency,
        priceRange: product.priceRange,
        brand: product.brand,
        primaryCategory: product.primaryCategory,
        categories: product.categories.map((entry) => entry.category),
        collections: product.collections.map((entry) => entry.collection),
        tags: product.tags,
        features: product.features,
        media: product.media.map((entry) => ({
          id: entry.media.id,
          type: entry.media.type,
          publicId: entry.media.publicId,
          url: entry.media.url,
          alt: entry.media.alt,
          position: entry.position,
        })),
        options: product.options.map((option) => ({
          id: option.id,
          name: option.name,
          values: option.values.map((value) => ({ id: value.id, value: value.value })),
        })),
        variants: product.variants.map((variant) => {
          const price = resolvePrice(variant);
          return {
            id: variant.id,
            sku: variant.sku,
            name: variant.name,
            priceCents: price.effectiveCents,
            compareAtPriceCents: price.compareAtCents,
            discountPercent: price.discountPercent,
            stock: stockStatus(variant.inventory),
            valueIds: variant.selections.map((selection) => selection.valueId),
            dimensions: {
              insertableLengthMm: variant.insertableLengthMm,
              diameterMm: variant.diameterMm,
              weightGrams: variant.weightGrams,
            },
          };
        }),
        specifications: product.productAttributes
          .filter((attribute) => attribute.definition.isSpec)
          .map((attribute) => ({
            key: attribute.definition.key,
            label: attribute.definition.label,
            value: attribute.value,
            unit: attribute.definition.unit,
            group: attribute.definition.group,
          })),
        rating: summary,
        shippingNote: product.shippingNote,
        returnPolicyNote: product.returnPolicyNote,
        related,
      },
      // Short public TTL with a long stale window: the CDN keeps serving while a
      // single origin request refreshes.
      { headers: { 'Cache-Control': cacheControl.catalogue } },
    );
  },
  { rateLimit: { bucket: 'catalogue', limit: 240, windowSeconds: 60 } },
);
