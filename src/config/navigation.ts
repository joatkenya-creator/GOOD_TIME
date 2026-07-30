import { ROUTES } from '@/constants/routes';

export interface NavItem {
  label: string;
  href: string;
  /** Rendered but visually flagged until the destination exists. */
  description?: string;
  children?: NavItem[];
}

/**
 * Navigation is data, not markup. Phase 2 renders these trees; phase 1 only
 * declares them so the shell, sitemap and breadcrumbs share one definition.
 */
export const primaryNav: NavItem[] = [
  { label: 'Shop', href: ROUTES.shop },
  { label: 'Collections', href: ROUTES.collections },
  { label: 'Brands', href: ROUTES.brands },
  { label: 'Journal', href: ROUTES.blog },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
  {
    title: 'Shop',
    items: [
      { label: 'All products', href: ROUTES.shop },
      { label: 'Collections', href: ROUTES.collections },
      { label: 'Brands', href: ROUTES.brands },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Shipping & delivery', href: '/pages/shipping' },
      { label: 'Returns', href: '/pages/returns' },
      { label: 'Contact us', href: '/pages/contact' },
    ],
  },
  {
    title: 'Company',
    items: [
      { label: 'About', href: '/pages/about' },
      { label: 'Journal', href: ROUTES.blog },
      { label: 'Privacy policy', href: '/pages/privacy' },
      { label: 'Terms of service', href: '/pages/terms' },
    ],
  },
];

export const accountNav: NavItem[] = [
  { label: 'Overview', href: ROUTES.account.root },
  { label: 'Orders', href: ROUTES.account.orders },
  { label: 'Addresses', href: ROUTES.account.addresses },
  { label: 'Wishlist', href: ROUTES.account.wishlist },
];

export const adminNav: NavItem[] = [
  { label: 'Dashboard', href: ROUTES.admin.root },
  { label: 'Products', href: ROUTES.admin.products },
  { label: 'Orders', href: ROUTES.admin.orders },
  { label: 'Customers', href: ROUTES.admin.customers },
  { label: 'Content', href: ROUTES.admin.content },
  { label: 'Settings', href: ROUTES.admin.settings },
];
