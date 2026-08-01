import {
  BatteryCharging,
  BookOpen,
  Droplets,
  Lock,
  MessagesSquare,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  Truck,
} from 'lucide-react';

import type { BlogCardData } from '@/components/product/blog-card';
import type { CategoryCardData } from '@/components/product/category-card';
import type { CollectionCardData } from '@/components/product/collection-card';
import type { ReviewCardData } from '@/components/product/review-card';
import type { FeatureCardData } from '@/components/common/feature-card';

/**
 * Homepage placeholder content.
 *
 * Every section reads from here rather than hard-coding copy into JSX, so the
 * layout can be reviewed against realistic content today and swapped for
 * database queries in a later phase without touching a single component.
 *
 * ## Voice
 *
 * This is a sex toy retailer, and the copy is written accordingly: plain product
 * nouns, real specifications, no euphemism and no innuendo. In this category the
 * things that actually convert are material safety, noise level, charge life and
 * discretion — so those are what the copy leads with. "Premium" here means the
 * spec sheet is honest, not that the adjectives are florid.
 *
 * Brand names are fictional placeholders; do not swap in real manufacturers
 * without a supply agreement.
 */

export const hero = {
  eyebrow: 'Body-safe toys, built to last',
  title: 'Specs you can check, not claims you have to trust',
  description:
    'Every toy here is non-porous, phthalate-free and rechargeable, with the material, decibel level and insertable length listed before you add it to the cart. Shipped in a plain box with a neutral billing descriptor.',
  primaryCta: { label: 'Shop all toys', href: '/shop' },
  secondaryCta: { label: 'Our materials standard', href: '/pages/materials' },
  imageSeed: 'hero-quiet-hours',
  stats: [
    { value: 50_000, suffix: '+', label: 'Orders shipped discreetly' },
    { value: 4.8, label: 'Average rating', isDecimal: true },
    { value: 100, suffix: '%', label: 'Non-porous materials' },
  ],
};

export const featuredCategories: (CategoryCardData & { href: string; feature?: boolean })[] = [
  {
    slug: 'vibrators',
    name: 'Vibrators',
    productCount: 86,
    imageSeed: 'cat-vibrators',
    href: '/shop/vibrators',
    feature: true,
  },
  {
    slug: 'dildos',
    name: 'Dildos',
    productCount: 47,
    imageSeed: 'cat-dildos',
    href: '/shop/dildos',
  },
  {
    slug: 'anal',
    name: 'Anal play',
    productCount: 39,
    imageSeed: 'cat-anal',
    href: '/shop/anal',
  },
  {
    slug: 'strokers',
    name: 'Strokers & sleeves',
    productCount: 24,
    imageSeed: 'cat-strokers',
    href: '/shop/strokers',
  },
  {
    slug: 'bondage-kink',
    name: 'Bondage & kink',
    productCount: 52,
    imageSeed: 'cat-kink',
    href: '/shop/bondage-kink',
  },
  {
    slug: 'couples',
    name: 'Couples’ toys',
    productCount: 33,
    imageSeed: 'cat-couples',
    href: '/shop/couples',
    feature: true,
  },
];

export const collections: (CollectionCardData & { href: string })[] = [
  {
    slug: 'first-toy',
    title: 'First Toy',
    eyebrow: 'Start here',
    description:
      'Nine toys chosen for a first purchase: modest sizes, simple controls, quiet motors and no learning curve. Each listing states insertable length and decibel level, so nothing arrives as a surprise.',
    imageSeed: 'coll-first-toy',
    href: '/collections/first-toy',
    cta: 'Shop First Toy',
  },
  {
    slug: 'quiet-hours',
    title: 'The Quiet Hours',
    eyebrow: 'New collection',
    description:
      'Everything in this edit runs under 45 dB — quieter than a fridge. Rechargeable, body-safe silicone, and tested against a wall rather than in a soundproof booth.',
    imageSeed: 'coll-quiet-hours',
    href: '/collections/quiet-hours',
    cta: 'Shop The Quiet Hours',
  },
  {
    slug: 'better-together',
    title: 'Better Together',
    eyebrow: 'For two',
    description:
      'Rings, wearables and app-controlled toys designed to be used with someone else. Grouped by who does the controlling, because that is the part people actually want to choose.',
    imageSeed: 'coll-better-together',
    href: '/collections/better-together',
    cta: 'Shop Better Together',
  },
];

export const whyShopWithUs: FeatureCardData[] = [
  {
    icon: Lock,
    title: 'Private, secure checkout',
    description:
      'Encrypted end to end. Your statement reads a neutral company descriptor, never a product name, and we never sell customer data.',
  },
  {
    icon: Truck,
    title: 'Plain, discreet shipping',
    description:
      'Free over $75, shipped from the US in an unbranded box with no product detail on the label or the customs form.',
  },
  {
    icon: MessagesSquare,
    title: 'Support trained on the specs',
    description:
      'A judgement-free team who have read the spec sheets. Real answers on sizing, material compatibility and motor strength.',
  },
  {
    icon: RotateCcw,
    title: 'Warranty & hygiene policy',
    description:
      'Sealed items return free within 30 days. Anything that fails within its warranty is replaced — for hygiene reasons, opened toys cannot be resold.',
  },
];

export const brandValues: FeatureCardData[] = [
  {
    icon: ShieldCheck,
    title: 'Non-porous or not stocked',
    description:
      'Platinum-cure silicone, borosilicate glass, 316L stainless steel and ABS only. No jelly, no PVC, no unlabelled TPR — porous materials cannot be properly sanitised, so we do not sell them.',
  },
  {
    icon: BatteryCharging,
    title: 'Rechargeable, not disposable',
    description:
      'Magnetic or USB-C charging on every powered toy, with the charge time and runtime published. A toy that dies with its battery is a toy you throw away.',
  },
  {
    icon: PackageCheck,
    title: 'Discretion by default',
    description:
      'Plain outer box, neutral billing descriptor, no marketing inserts and no product names on any paperwork. Discretion is not a paid add-on.',
  },
  {
    icon: BookOpen,
    title: 'Guidance, not innuendo',
    description:
      'Every guide is written or reviewed by a certified sex educator. Anatomically correct language, safety first, and no pressure to buy anything.',
  },
];

export const reviews: ReviewCardData[] = [
  {
    id: 'r1',
    author: 'Maya R.',
    location: 'Austin, TX',
    rating: 5,
    title: 'The decibel rating was accurate',
    body: 'I share a wall with my neighbour, so the noise spec was the whole reason I bought this one. It is genuinely quiet — quieter than my electric toothbrush — and the listing did not exaggerate.',
    productName: 'Pebble Bullet Vibrator',
    verified: true,
  },
  {
    id: 'r2',
    author: 'Devon K.',
    location: 'Portland, OR',
    rating: 5,
    title: 'Finally, materials I can actually verify',
    body: 'Every listing names the exact material and what it was tested for. I have spent years emailing shops to ask whether something is real silicone or porous TPR. Not needed here.',
    productName: 'Meridian Silicone Dildo',
    verified: true,
  },
  {
    id: 'r3',
    author: 'Priya S.',
    location: 'Chicago, IL',
    rating: 5,
    title: 'Plain box, nothing on the label',
    body: 'Ordered to a shared apartment building. Unmarked box, no branding, and the card statement showed a neutral name. Exactly what was promised on the shipping page.',
    productName: 'Aurora Rechargeable Wand',
    verified: true,
  },
  {
    id: 'r4',
    author: 'Alex T.',
    location: 'Brooklyn, NY',
    rating: 5,
    title: 'Support answered a very specific question',
    body: 'Asked whether a silicone toy was safe with a silicone lubricant. Got a clear, unembarrassed answer within a few hours, plus a link to the compatibility chart. No awkwardness at all.',
    productName: 'Tide Water-Based Lubricant',
    verified: true,
  },
  {
    id: 'r5',
    author: 'Jordan M.',
    location: 'Denver, CO',
    rating: 4,
    title: 'Good first purchase, sizing was honest',
    body: 'The First Toy collection made this much less daunting. Insertable length was listed and accurate. Four stars only because I would have liked more colour options.',
    productName: 'Graduated Silicone Plug Trio',
    verified: true,
  },
  {
    id: 'r6',
    author: 'Sam W.',
    location: 'Seattle, WA',
    rating: 5,
    title: 'Charge life as advertised',
    body: 'Listed at two hours of runtime and it holds up. USB-C rather than a proprietary cable, which is the detail that made me choose it over a better-known brand.',
    productName: 'Ember Dual-Stimulation Vibrator',
    verified: true,
  },
];

export const journalPosts: BlogCardData[] = [
  {
    slug: 'choosing-your-first-vibrator',
    title: 'Choosing your first vibrator: a plain-language guide',
    excerpt:
      'External, internal or dual — what each one does, what sizes to start with, and why motor type matters more than the number of vibration patterns.',
    category: 'Buying guides',
    publishedAt: '2026-07-14',
    readingMinutes: 9,
    imageSeed: 'post-first-vibrator',
  },
  {
    slug: 'silicone-glass-or-steel',
    title: 'Silicone, glass or steel: how to read a materials label',
    excerpt:
      'Non-porous, phthalate-free, body-safe — three phrases used very loosely. What each actually means, which materials cannot be sanitised, and how to verify a claim.',
    category: 'Materials',
    publishedAt: '2026-07-02',
    readingMinutes: 7,
    imageSeed: 'post-materials',
  },
  {
    slug: 'cleaning-and-storing-toys',
    title: 'Cleaning and storing toys, by material type',
    excerpt:
      'Most toys fail early because of storage, not use. Which materials can be boiled, which lubricants degrade silicone, and why toys should not touch each other in a drawer.',
    category: 'Care',
    publishedAt: '2026-06-21',
    readingMinutes: 6,
    imageSeed: 'post-care',
  },
];

export const galleryItems = [
  { seed: 'gallery-1', label: 'Storage case, open' },
  { seed: 'gallery-2', label: 'Charging dock detail' },
  { seed: 'gallery-3', label: 'Silicone texture close-up' },
  { seed: 'gallery-4', label: 'Plain packaging, as shipped' },
  { seed: 'gallery-5', label: 'Steel and glass, side by side' },
  { seed: 'gallery-6', label: 'Gift set flat lay' },
  { seed: 'gallery-7', label: 'Lubricant range' },
  { seed: 'gallery-8', label: 'Studio product shot' },
];

export const promo = {
  eyebrow: 'Summer edit — ends Sunday',
  title: 'Up to 40% off rechargeable vibrators',
  description:
    'Wands, bullets and dual-stimulation toys, all body-safe silicone and USB-C rechargeable. Discounted while stocks last, shipped free over $75 in a plain box.',
  href: '/shop?onSaleOnly=true',
  cta: 'Shop the sale',
  secondary: { label: 'See what is included', href: '/collections/quiet-hours' },
  imageSeed: 'promo-summer',
  terms:
    'Discount applied automatically at checkout. Ends Sunday at 11:59pm ET. While stocks last. Cannot be combined with other offers. Must be 18 or older to purchase.',
};

export const newsletter = {
  eyebrow: 'Stay in the loop',
  title: 'Ten percent off, and nothing you did not ask for',
  description:
    'Restocks, new arrivals and the occasional buying guide. Discreet subject lines that never name a product, roughly twice a month, unsubscribe in one click.',
};

/** Icons re-exported for sections that render an inline spec row. */
export const specIcons = { lubricant: Droplets, charging: BatteryCharging };
