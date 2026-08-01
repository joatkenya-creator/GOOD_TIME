import { ROUTES } from '@/constants/routes';

export interface NavItem {
  label: string;
  href: string;
  description?: string;
  /** Small flag rendered beside the label — "New", "Sale". */
  tag?: string;
}

export interface MegaMenuColumn {
  title: string;
  items: NavItem[];
}

export interface MegaMenuFeature {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  imageSeed: string;
}

export interface PrimaryNavItem extends NavItem {
  /** Present means the item opens a mega menu rather than navigating directly. */
  columns?: MegaMenuColumn[];
  feature?: MegaMenuFeature;
}

/**
 * Navigation is data, not markup.
 *
 * One definition feeds the desktop mega menu, the mobile drawer and the footer,
 * so a new category cannot appear in one place and be forgotten in the others.
 *
 * Placeholder taxonomy for phase 2 — the real tree comes from the `Category`
 * table once the catalogue exists.
 */
export const primaryNav: PrimaryNavItem[] = [
  {
    label: 'Shop',
    href: ROUTES.shop,
    columns: [
      {
        title: 'By type',
        items: [
          { label: 'Vibrators', href: ROUTES.category('vibrators') },
          { label: 'Dildos', href: ROUTES.category('dildos') },
          { label: 'Anal play', href: ROUTES.category('anal') },
          { label: 'Strokers & sleeves', href: ROUTES.category('strokers') },
          { label: 'Couples’ toys', href: ROUTES.category('couples') },
          { label: 'Bondage & kink', href: ROUTES.category('bondage-kink') },
          { label: 'Lubricants & care', href: ROUTES.category('lubricants-care') },
        ],
      },
      {
        title: 'By feature',
        items: [
          { label: 'Rechargeable', href: `${ROUTES.shop}?tag=rechargeable` },
          { label: 'Waterproof (IPX7)', href: `${ROUTES.shop}?tag=waterproof` },
          { label: 'App controlled', href: `${ROUTES.shop}?tag=app-controlled` },
          { label: 'Whisper quiet', href: `${ROUTES.shop}?tag=quiet` },
          { label: 'Beginner friendly', href: `${ROUTES.shop}?tag=beginner` },
          { label: 'Body-safe silicone', href: `${ROUTES.shop}?tag=silicone` },
        ],
      },
      {
        title: 'Shop by price',
        items: [
          { label: 'Under $40', href: `${ROUTES.shop}?maxPriceCents=4000` },
          { label: '$40 – $80', href: `${ROUTES.shop}?minPriceCents=4000&maxPriceCents=8000` },
          { label: '$80 – $150', href: `${ROUTES.shop}?minPriceCents=8000&maxPriceCents=15000` },
          { label: 'Premium over $150', href: `${ROUTES.shop}?minPriceCents=15000` },
          { label: 'Sale', href: `${ROUTES.shop}?onSaleOnly=true`, tag: 'Sale' },
        ],
      },
    ],
    feature: {
      eyebrow: 'New in',
      title: 'The Quiet Hours edit',
      description:
        'Rechargeable, under 45 dB, and body-safe silicone throughout. Built for thin walls.',
      href: ROUTES.collection('quiet-hours'),
      cta: 'See the edit',
      imageSeed: 'menu-quiet-hours',
    },
  },
  {
    label: 'Collections',
    href: ROUTES.collections,
    columns: [
      {
        title: 'Featured',
        items: [
          { label: 'The Quiet Hours', href: ROUTES.collection('quiet-hours'), tag: 'New' },
          { label: 'First Toy', href: ROUTES.collection('first-toy') },
          { label: 'Better Together', href: ROUTES.collection('better-together') },
          { label: 'Kink Curious', href: ROUTES.collection('kink-curious') },
          { label: 'The Gift Edit', href: ROUTES.collection('gift-edit') },
        ],
      },
      {
        title: 'Materials',
        items: [
          { label: 'Platinum-cure silicone', href: ROUTES.collection('silicone') },
          { label: 'Borosilicate glass', href: ROUTES.collection('glass') },
          { label: 'Stainless steel', href: ROUTES.collection('steel') },
          { label: 'Non-porous only', href: ROUTES.collection('non-porous') },
        ],
      },
    ],
  },
  { label: 'Deals', href: `${ROUTES.shop}?onSaleOnly=true`, tag: 'Up to 40% off' },
  { label: 'Guides', href: ROUTES.blog },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
  {
    title: 'Shop',
    items: [
      { label: 'All products', href: ROUTES.shop },
      { label: 'Vibrators', href: ROUTES.category('vibrators') },
      { label: 'Couples’ toys', href: ROUTES.category('couples') },
      { label: 'Lubricants & care', href: ROUTES.category('lubricants-care') },
      { label: 'Deals', href: `${ROUTES.shop}?onSaleOnly=true` },
      { label: 'Gift cards', href: ROUTES.page('gift-cards') },
    ],
  },
  {
    title: 'Customer service',
    items: [
      { label: 'Help centre', href: ROUTES.page('help') },
      { label: 'Shipping & delivery', href: ROUTES.page('shipping') },
      { label: 'Returns & hygiene policy', href: ROUTES.page('returns') },
      { label: 'Warranty claims', href: ROUTES.page('warranty') },
      { label: 'Track your order', href: ROUTES.account.orders },
      { label: 'Contact us', href: ROUTES.page('contact') },
    ],
  },
  {
    title: 'Learn',
    items: [
      { label: 'Buying guides', href: ROUTES.blog },
      { label: 'Materials explained', href: ROUTES.page('materials') },
      { label: 'Cleaning & care', href: ROUTES.page('care') },
      { label: 'Lubricant compatibility', href: ROUTES.page('lubricant-guide') },
      { label: 'Discreet packaging', href: ROUTES.page('discreet-packaging') },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Privacy policy', href: ROUTES.page('privacy') },
      { label: 'Terms of service', href: ROUTES.page('terms') },
      { label: 'Accessibility', href: ROUTES.page('accessibility') },
      { label: 'Cookie preferences', href: ROUTES.page('cookies') },
    ],
  },
];

export const accountNav: NavItem[] = [
  { label: 'Overview', href: ROUTES.account.root },
  { label: 'Orders', href: ROUTES.account.orders },
  { label: 'Addresses', href: ROUTES.account.addresses },
  { label: 'Wishlist', href: ROUTES.account.wishlist },
  { label: 'Profile', href: ROUTES.account.profile },
  { label: 'Security', href: ROUTES.account.security },
];

export const adminNav: NavItem[] = [
  { label: 'Dashboard', href: ROUTES.admin.root },
  { label: 'Products', href: ROUTES.admin.products },
  { label: 'Orders', href: ROUTES.admin.orders },
  { label: 'Customers', href: ROUTES.admin.customers },
  { label: 'Content', href: ROUTES.admin.content },
  { label: 'Settings', href: ROUTES.admin.settings },
];

/** Rotating messages in the announcement bar. */
export const announcements: { text: string; href?: string; linkLabel?: string }[] = [
  {
    text: 'Free discreet shipping on orders over $75',
    href: ROUTES.page('shipping'),
    linkLabel: 'See details',
  },
  {
    text: 'Plain box, no branding, neutral billing descriptor',
    href: ROUTES.page('discreet-packaging'),
    linkLabel: 'How it works',
  },
  {
    text: 'Every toy body-safe and non-porous, or we do not stock it',
    href: ROUTES.page('materials'),
    linkLabel: 'Our materials standard',
  },
];
