import { Lock, PackageCheck, RotateCcw, Truck } from 'lucide-react';
import Link from 'next/link';

import { JsonLd } from '@/components/common/json-ld';
import { ProductGallery } from '@/components/catalog/product-gallery';
import { ProductPurchasePanel } from '@/components/catalog/product-purchase-panel';
import { RecentlyViewedRail } from '@/components/catalog/recently-viewed-rail';
import { ReviewSection } from '@/components/catalog/review-section';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Container } from '@/components/layout/container';
import { ProductCard } from '@/components/product/product-card';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Carousel } from '@/components/ui/carousel';
import { Rating } from '@/components/ui/rating';
import { resolvePrice, stockStatus } from '@/features/catalog/pricing';
import type { BreadcrumbEntry } from '@/lib/seo/json-ld';
import { breadcrumbSchema, productSchema } from '@/lib/seo/json-ld';
import type { ProductCardView, ProductDetail } from '@/services/product.service';
import type { RatingSummary, ReviewListItem } from '@/services/review.service';
import { formatPrice } from '@/utils/format';

export interface ProductViewProps {
  product: ProductDetail;
  trail: BreadcrumbEntry[];
  canonicalPath: string;
  summary: RatingSummary;
  reviews: ReviewListItem[];
  reviewPage: number;
  reviewTotalPages: number;
  buildReviewHref: (page: number) => string;
  related: ProductCardView[];
  frequentlyBoughtTogether: ProductCardView[];
}

const TRUST = [
  { icon: Lock, label: 'Neutral billing descriptor' },
  { icon: Truck, label: 'Free discreet shipping over $75' },
  { icon: PackageCheck, label: 'Plain, unbranded packaging' },
  { icon: RotateCcw, label: '30-day returns on unopened items' },
];

/**
 * Product detail page.
 *
 * Server-rendered apart from the gallery and the purchase panel. Everything that
 * matters for search — title, price, availability, specifications, reviews and
 * the JSON-LD graph — is in the initial HTML.
 *
 * Section order follows the questions a buyer in this category asks, in order:
 * what is it, what does it cost, is it in stock, what is it made of, how do I
 * clean it, what did other people think.
 */
export function ProductView({
  product,
  trail,
  canonicalPath,
  summary,
  reviews,
  reviewPage,
  reviewTotalPages,
  buildReviewHref,
  related,
  frequentlyBoughtTogether,
}: ProductViewProps) {
  const firstVariant = product.variants.find((variant) => variant.isActive) ?? product.variants[0];
  const price = firstVariant
    ? resolvePrice(firstVariant)
    : {
        effectiveCents: 0,
        compareAtCents: null,
        isOnSale: false,
        discountPercent: 0,
        savingCents: 0,
      };

  const stock = stockStatus(firstVariant?.inventory ?? null);
  const inStock = stock === 'IN_STOCK' || stock === 'LOW_STOCK' || stock === 'BACKORDER';

  const gallery = product.media.map((entry) => ({
    id: entry.media.id,
    seed: entry.media.publicId,
    alt: entry.media.alt ?? product.name,
    type: entry.media.type,
  }));

  // Specifications, grouped exactly as the attribute definitions declare.
  const specGroups = groupSpecs(product.productAttributes);

  return (
    <>
      <JsonLd
        schema={[
          breadcrumbSchema(trail),
          productSchema({
            name: product.name,
            slug: product.slug,
            description: product.shortDescription ?? product.description,
            sku: firstVariant?.sku ?? product.sku ?? product.slug,
            brandName: product.brand?.name ?? null,
            images: gallery.map((item) => item.seed),
            minPriceCents: product.priceRange.minPriceCents,
            maxPriceCents: product.priceRange.maxPriceCents,
            currency: product.currency,
            inStock,
            ratingAverage: summary.average,
            ratingCount: summary.total,
          }),
        ]}
      />

      <Container className="py-8 lg:py-12">
        <Breadcrumbs trail={trail} className="mb-8" />

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
          <ProductGallery items={gallery} productName={product.name} />

          <div>
            {product.brand ? (
              <Link
                href={`/shop?brand=${product.brand.slug}`}
                className="inline-flex min-h-6 items-center rounded-sm text-eyebrow text-accent-text uppercase hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
              >
                {product.brand.name}
              </Link>
            ) : null}

            <h1 className="mt-3 text-display-lg text-foreground">{product.name}</h1>

            {product.shortDescription ? (
              <p className="mt-4 text-body-lg leading-relaxed text-foreground-muted">
                {product.shortDescription}
              </p>
            ) : null}

            {summary.total > 0 ? (
              <a
                href="#reviews"
                className="mt-5 inline-flex min-h-6 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
              >
                <Rating value={summary.average} count={summary.total} />
                <span className="sr-only">Jump to reviews</span>
              </a>
            ) : null}

            <ProductPurchasePanel
              productId={product.id}
              productName={product.name}
              currency={product.currency}
              options={product.options.map((option) => ({
                id: option.id,
                name: option.name,
                values: option.values.map((value) => ({ id: value.id, value: value.value })),
              }))}
              variants={product.variants.map((variant) => ({
                id: variant.id,
                name: variant.name,
                sku: variant.sku,
                priceCents: variant.priceCents,
                salePriceCents: variant.salePriceCents,
                compareAtPriceCents: variant.compareAtPriceCents,
                valueIds: variant.selections.map((selection) => selection.valueId),
                isActive: variant.isActive,
                inventory: variant.inventory
                  ? {
                      quantity: variant.inventory.quantity,
                      reserved: variant.inventory.reserved,
                      lowStockThreshold: variant.inventory.lowStockThreshold,
                      policy: variant.inventory.policy,
                    }
                  : null,
                insertableLengthMm: variant.insertableLengthMm,
                diameterMm: variant.diameterMm,
                weightGrams: variant.weightGrams,
              }))}
            />

            {price.savingCents > 0 ? (
              <p className="mt-4 text-body-sm font-medium text-success-700">
                You save {formatPrice(price.savingCents, product.currency)} ({price.discountPercent}
                %)
              </p>
            ) : null}

            <ul className="mt-8 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
              {TRUST.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2.5 text-body-sm text-foreground-muted"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
                  {label}
                </li>
              ))}
            </ul>

            {product.tags.length ? (
              <ul className="mt-6 flex flex-wrap gap-2">
                {product.tags.map((tag) => (
                  <li key={tag.slug}>
                    {/* `min-h-6`: a standalone filter link, so WCAG 2.5.8 applies. */}
                    <Link
                      href={`/shop?tag=${tag.slug}`}
                      className="inline-flex min-h-6 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
                    >
                      <Badge variant="neutral">{tag.name}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {/* --- Detail accordions --------------------------------------- */}
        <div className="mt-16 max-w-3xl">
          <Accordion>
            <AccordionItem question="Description" group="product-detail" open>
              {product.description ? (
                <div className="space-y-4">
                  {product.description.split('\n\n').map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p>{product.shortDescription}</p>
              )}

              {product.features.length ? (
                <ul className="mt-5 space-y-2">
                  {product.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AccordionItem>

            <AccordionItem question="Specifications" group="product-detail">
              {specGroups.length ? (
                <div className="space-y-6">
                  {specGroups.map((group) => (
                    <div key={group.name}>
                      <p className="text-eyebrow text-foreground-subtle uppercase">{group.name}</p>
                      <dl className="mt-3 divide-y divide-border">
                        {group.rows.map((row) => (
                          <div key={row.label} className="flex justify-between gap-6 py-2.5">
                            <dt className="text-foreground-muted">{row.label}</dt>
                            <dd className="text-right font-medium text-foreground">
                              {row.value}
                              {row.unit ? ` ${row.unit}` : ''}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              ) : (
                <p>Specifications for this product are being finalised.</p>
              )}
            </AccordionItem>

            <AccordionItem question="Shipping & delivery" group="product-detail">
              <p>{product.shippingNote}</p>
              <p className="mt-3">
                {/* Estimated delivery is computed rather than hard-coded, so it
                    stays honest as the date moves. */}
                Order today and standard delivery is estimated{' '}
                <strong className="font-medium text-foreground">{estimatedDelivery()}</strong>.
              </p>
            </AccordionItem>

            <AccordionItem question="Returns & warranty" group="product-detail">
              <p>{product.returnPolicyNote}</p>
            </AccordionItem>
          </Accordion>
        </div>

        {/* --- Frequently bought together ------------------------------ */}
        {frequentlyBoughtTogether.length ? (
          <section aria-labelledby="fbt-heading" className="mt-20">
            <h2 id="fbt-heading" className="text-display-md text-foreground">
              Frequently bought together
            </h2>
            <p className="mt-3 max-w-xl text-body-sm text-foreground-muted">
              What other customers added alongside this, based on actual orders.
            </p>

            <ol className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
              {frequentlyBoughtTogether.map((item) => (
                <li key={item.id}>
                  <ProductCard product={item} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* --- Reviews -------------------------------------------------- */}
        <div className="mt-20">
          <ReviewSection
            summary={summary}
            reviews={reviews}
            page={reviewPage}
            totalPages={reviewTotalPages}
            buildHref={buildReviewHref}
          />
        </div>

        {/* --- Related -------------------------------------------------- */}
        {related.length ? (
          <section aria-labelledby="related-heading" className="mt-20">
            <h2 id="related-heading" className="text-display-md text-foreground">
              You may also like
            </h2>

            <Carousel label="Related products" className="mt-8">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} fixedWidth />
              ))}
            </Carousel>
          </section>
        ) : null}

        <RecentlyViewedRail currentProductId={product.id} canonicalPath={canonicalPath} />
      </Container>
    </>
  );
}

/** Groups attributes by their declared spec-table section. */
function groupSpecs(attributes: ProductDetail['productAttributes']) {
  const groups = new Map<string, { label: string; value: string; unit: string | null }[]>();

  for (const attribute of attributes) {
    if (!attribute.definition.isSpec) continue;

    const group = attribute.definition.group;
    const rows = groups.get(group) ?? [];
    rows.push({
      label: attribute.definition.label,
      value: attribute.value,
      unit: attribute.definition.unit,
    });
    groups.set(group, rows);
  }

  return [...groups.entries()].map(([name, rows]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    rows,
  }));
}

/**
 * Estimated delivery window.
 *
 * Business days only — quoting a Sunday arrival is the fastest way to generate a
 * "where is my order" ticket.
 */
function estimatedDelivery(): string {
  const date = new Date();
  let added = 0;

  while (added < 4) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }

  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
