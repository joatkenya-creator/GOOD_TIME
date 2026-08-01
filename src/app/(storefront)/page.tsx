import type { Metadata } from 'next';

import { JsonLd } from '@/components/common/json-ld';
import { BestSellersSection } from '@/components/home/best-sellers-section';
import { CategoriesSection } from '@/components/home/categories-section';
import { CollectionsSection } from '@/components/home/collections-section';
import { GallerySection } from '@/components/home/gallery-section';
import { HeroSection } from '@/components/home/hero-section';
import { JournalSection } from '@/components/home/journal-section';
import { NewsletterSection } from '@/components/home/newsletter-section';
import { PromoSection } from '@/components/home/promo-section';
import { ReviewsSection } from '@/components/home/reviews-section';
import { TrendingSection } from '@/components/home/trending-section';
import { ValuesSection } from '@/components/home/values-section';
import { WhyShopSection } from '@/components/home/why-shop-section';
import { siteConfig } from '@/config/site';
import { organizationSchema, websiteSchema } from '@/lib/seo/json-ld';
import { buildMetadata } from '@/lib/seo/metadata';
import { listProductRail } from '@/services/product.service';

export const metadata: Metadata = buildMetadata({
  title: `${siteConfig.name} — Body-safe sex toys, built to last`,
  description:
    'Shop body-safe sex toys with published specs: platinum-cure silicone, borosilicate glass and 316L steel, USB-C rechargeable, decibel levels listed. Free discreet shipping over $75. Must be 18+.',
  path: '/',
  type: 'website',
  keywords: [
    'body-safe sex toys',
    'silicone vibrators',
    'rechargeable vibrator',
    'discreet shipping',
    'non-porous sex toys',
  ],
});

/**
 * Homepage.
 *
 * Every section is a server component; only the carousels, quick-view controls,
 * search, mega menu and scroll reveals hydrate. That keeps the client bundle to
 * a handful of small islands rather than shipping the whole page twice.
 *
 * Section order follows the decision a first-time visitor actually makes:
 * what is this (hero) → what do you sell (categories, best sellers) → can I
 * trust you with my address and card (why shop) → what is the offer (promo) →
 * more to browse (trending) → do others trust you (reviews) → what do you stand
 * for (values) → help me choose (guides, newsletter, gallery).
 *
 * In this category the trust section carries unusual weight: discretion,
 * material safety and billing privacy are the objections that stop a purchase,
 * so they appear above the fold-and-a-half rather than in the footer.
 */
export default async function HomePage() {
  /*
   * Both rails come from the catalog, in two queries rather than four.
   *
   * They used to be hand-written arrays: sixteen products with invented ids,
   * ten of which were never seeded, every one linking to `/products/<slug>` —
   * a route this app has never served. The homepage advertised a shop that did
   * not exist, and nothing failed until someone followed a link.
   */
  const [best, newest] = await Promise.all([
    listProductRail('best_selling', 8),
    listProductRail('newest', 8),
  ]);

  return (
    <>
      {/* Site-level structured data lives on the homepage, which is the graph's root. */}
      <JsonLd schema={[organizationSchema(), websiteSchema()]} />

      {/* The page's only <h1> is the hero headline — see HeroSection. */}
      <HeroSection />
      <CategoriesSection />
      <BestSellersSection products={best} />
      <CollectionsSection />
      <WhyShopSection />
      <PromoSection />
      <TrendingSection products={newest} />
      <ReviewsSection />
      <ValuesSection />
      <JournalSection />
      <NewsletterSection />
      <GallerySection />
    </>
  );
}
