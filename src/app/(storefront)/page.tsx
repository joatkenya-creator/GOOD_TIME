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
import { listPosts } from '@/services/blog.service';
import { listProductRail } from '@/services/product.service';

export const metadata: Metadata = buildMetadata({
  title: `${siteConfig.name} — Body-safe sex toys, built to last`,
  /*
   * Under 160 characters.
   *
   * Google truncates around 155–160 on desktop and less on mobile. The previous
   * version ran to 199, so the last third — which is where the shipping offer
   * and the 18+ notice lived — was never shown to anyone. Everything that has
   * to survive truncation now sits in the first two clauses.
   */
  description:
    'Body-safe sex toys with published specs: platinum-cure silicone, borosilicate glass, 316L steel. Free discreet shipping over $75. Must be 18+.',
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
  const [best, newest, guides] = await Promise.all([
    listProductRail('best_selling', 8),
    listProductRail('newest', 8),
    /*
     * The journal preview had the same defect as the rails above: three
     * hardcoded articles whose `/guides/*` links had no posts behind them.
     * Reading published posts makes the link and the article one fact.
     */
    listPosts({ take: 3 }),
  ]);

  const journalCards = guides.map((post) => ({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt ?? '',
    // The first tag is the nearest thing to a section this model has; the
    // fallback keeps the card's eyebrow from collapsing to empty space.
    category: post.tags[0]?.name ?? 'Buying guides',
    publishedAt: (post.publishedAt ?? new Date()).toISOString().slice(0, 10),
    readingMinutes: post.readingMinutes,
    // Deterministic per post, so the placeholder image is stable across renders.
    imageSeed: `post-${post.slug}`,
  }));

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
      <JournalSection posts={journalCards} />
      <NewsletterSection />
      <GallerySection />
    </>
  );
}
