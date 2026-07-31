import { z } from 'zod';

import { readQuery, withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { COMPARE_LIMIT } from '@/features/catalog/local-list';
import { STOCK_LABELS, resolvePrice, stockStatus } from '@/features/catalog/pricing';
import { prisma } from '@/lib/prisma';
import { productHref } from '@/services/product.service';

/**
 * `GET /api/products/compare?ids=a,b,c`
 *
 * Comparison payload: the card essentials plus the full specification set, which
 * a listing card deliberately does not carry.
 *
 * Capped at `COMPARE_LIMIT` server-side as well as in the UI. A client-side cap
 * alone is a suggestion, not a limit.
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
    .pipe(z.array(z.string().min(1)).max(COMPARE_LIMIT)),
});

export const GET = withRoute(
  async ({ request }) => {
    const { ids } = readQuery(request, querySchema);

    const rows = await prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        currency: true,
        ratingAverage: true,
        ratingCount: true,
        brand: { select: { name: true } },
        primaryCategory: { select: { path: true } },
        media: {
          take: 1,
          orderBy: { position: 'asc' },
          select: { media: { select: { publicId: true } } },
        },
        variants: {
          where: { isActive: true, deletedAt: null },
          orderBy: { position: 'asc' },
          take: 1,
          select: {
            priceCents: true,
            salePriceCents: true,
            compareAtPriceCents: true,
            insertableLengthMm: true,
            diameterMm: true,
            weightGrams: true,
            inventory: {
              select: { quantity: true, reserved: true, lowStockThreshold: true, policy: true },
            },
          },
        },
        productAttributes: {
          orderBy: { definition: { position: 'asc' } },
          select: {
            value: true,
            definition: { select: { label: true, unit: true, isSpec: true } },
          },
        },
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));

    // Preserve the order the customer added them in — reordering the columns on
    // every render would be disorienting.
    const data = ids
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => Boolean(row))
      .map((row) => {
        const variant = row.variants[0];
        const price = variant
          ? resolvePrice(variant)
          : {
              effectiveCents: 0,
              compareAtCents: null,
              discountPercent: 0,
              isOnSale: false,
              savingCents: 0,
            };

        const attributes = row.productAttributes
          .filter((attribute) => attribute.definition.isSpec)
          .map((attribute) => ({
            label: attribute.definition.label,
            value: attribute.value,
            unit: attribute.definition.unit,
          }));

        // Physical measurements live on the variant, not the attribute table, but
        // belong in the same comparison grid.
        if (variant?.insertableLengthMm) {
          attributes.push({
            label: 'Insertable length',
            value: String(variant.insertableLengthMm),
            unit: 'mm',
          });
        }
        if (variant?.diameterMm) {
          attributes.push({
            label: 'Maximum diameter',
            value: String(variant.diameterMm),
            unit: 'mm',
          });
        }
        if (variant?.weightGrams) {
          attributes.push({ label: 'Weight', value: String(variant.weightGrams), unit: 'g' });
        }

        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          href: productHref(row.primaryCategory?.path, row.slug),
          brandName: row.brand?.name ?? null,
          imageSeed: row.media[0]?.media.publicId ?? row.slug,
          priceCents: price.effectiveCents,
          compareAtPriceCents: price.compareAtCents,
          currency: row.currency,
          rating: row.ratingAverage,
          reviewCount: row.ratingCount,
          stockLabel: STOCK_LABELS[stockStatus(variant?.inventory ?? null)].label,
          attributes,
        };
      });

    return jsonOk(data, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    });
  },
  { rateLimit: { bucket: 'catalogue', limit: 120, windowSeconds: 60 } },
);
