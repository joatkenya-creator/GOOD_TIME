import { PERMISSIONS, type Permission } from '@/constants/permissions';

/**
 * Icons are named, not imported.
 *
 * This config is read on the server — by the layout to filter the menu, and by
 * `findNavItem` for breadcrumbs. A React component cannot cross that boundary,
 * so the name travels and `admin-icons.tsx` resolves it on the client. It also
 * keeps the whole lucide set out of any server bundle that only wanted a label.
 */
export type AdminIconName =
  | 'dashboard'
  | 'reports'
  | 'products'
  | 'categories'
  | 'collections'
  | 'inventory'
  | 'media'
  | 'orders'
  | 'customers'
  | 'promotions'
  | 'pages'
  | 'blog'
  | 'seo'
  | 'staff'
  | 'audit'
  | 'settings'
  | 'imports'
  | 'jobs'
  | 'analytics'
  | 'search'
  | 'marketing';

/**
 * The admin's single navigation source.
 *
 * Sidebar, breadcrumbs, the command palette and the "you have nothing to do
 * here" redirect all read this. Four copies of the same list is how a renamed
 * route survives in three of them, and how a new page ends up in the menu for
 * people who cannot open it.
 *
 * Every entry names the permission it needs. That is not decoration — the
 * sidebar filters on it, so staff see a menu of what they can actually do
 * rather than a wall of links that bounce them back.
 */
export interface AdminNavItem {
  label: string;
  href: string;
  icon: AdminIconName;
  permission: Permission;
  /** Shown in the command palette to disambiguate similar names. */
  hint?: string;
  /** Matched as a prefix for active state and breadcrumbs. */
  match?: string;
  children?: { label: string; href: string; permission: Permission }[];
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Dashboard',
        href: '/admin',
        icon: 'dashboard',
        permission: PERMISSIONS.analyticsRead,
        hint: 'Revenue, orders and alerts',
      },
      {
        label: 'Reports',
        href: '/admin/reports',
        icon: 'reports',
        permission: PERMISSIONS.analyticsRead,
        hint: 'Sales, products, customers, inventory',
      },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      {
        label: 'Products',
        href: '/admin/products',
        icon: 'products',
        permission: PERMISSIONS.productRead,
        hint: 'Create, edit, publish and archive',
      },
      {
        label: 'Categories',
        href: '/admin/categories',
        icon: 'categories',
        permission: PERMISSIONS.productRead,
        hint: 'The nested category tree',
      },
      {
        label: 'Collections',
        href: '/admin/collections',
        icon: 'collections',
        permission: PERMISSIONS.productRead,
        hint: 'Manual and rule-driven groupings',
      },
      {
        label: 'Inventory',
        href: '/admin/inventory',
        icon: 'inventory',
        permission: PERMISSIONS.inventoryRead,
        hint: 'Stock levels, adjustments and history',
      },
      {
        label: 'Media',
        href: '/admin/media',
        icon: 'media',
        permission: PERMISSIONS.mediaRead,
        hint: 'Images and video, with alt text',
      },
    ],
  },
  {
    title: 'Commerce',
    items: [
      {
        label: 'Orders',
        href: '/admin/orders',
        icon: 'orders',
        permission: PERMISSIONS.orderRead,
        hint: 'Fulfilment, refunds and returns',
      },
      {
        label: 'Customers',
        href: '/admin/customers',
        icon: 'customers',
        permission: PERMISSIONS.customerRead,
        hint: 'Profiles, notes, tags and segments',
      },
      {
        label: 'Promotions',
        href: '/admin/promotions',
        icon: 'promotions',
        permission: PERMISSIONS.couponRead,
        hint: 'Coupons, gift cards and credit',
      },
    ],
  },
  {
    title: 'Content',
    items: [
      {
        label: 'Pages',
        href: '/admin/content',
        icon: 'pages',
        permission: PERMISSIONS.contentRead,
        hint: 'Pages, banners, FAQs and menus',
      },
      {
        label: 'Blog',
        href: '/admin/blog',
        icon: 'blog',
        permission: PERMISSIONS.contentRead,
        hint: 'Posts, tags and scheduling',
      },
      {
        label: 'SEO',
        href: '/admin/seo',
        icon: 'seo',
        permission: PERMISSIONS.seoWrite,
        hint: 'Metadata, redirects and sitemap',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'Imports',
        href: '/admin/imports',
        icon: 'imports',
        permission: PERMISSIONS.importRead,
        hint: 'Supplier feeds and catalogue uploads',
      },
      {
        label: 'Background jobs',
        href: '/admin/jobs',
        icon: 'jobs',
        permission: PERMISSIONS.jobsRead,
        hint: 'The queue, schedules and failures',
      },
      {
        label: 'Search',
        href: '/admin/search',
        icon: 'search',
        permission: PERMISSIONS.analyticsRead,
        hint: 'What people look for, and what they do not find',
      },
      {
        label: 'Analytics',
        href: '/admin/analytics',
        icon: 'analytics',
        permission: PERMISSIONS.analyticsRead,
        hint: 'Traffic, funnel and lifetime value',
      },
      {
        label: 'Marketing',
        href: '/admin/marketing',
        icon: 'marketing',
        permission: PERMISSIONS.settingsRead,
        hint: 'Tracking pixels and the Merchant feed',
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        label: 'Staff & roles',
        href: '/admin/staff',
        icon: 'staff',
        permission: PERMISSIONS.roleAssign,
        hint: 'Who can do what',
      },
      {
        label: 'Audit log',
        href: '/admin/audit',
        icon: 'audit',
        permission: PERMISSIONS.auditRead,
        hint: 'Every change, who made it and when',
      },
      {
        label: 'Settings',
        href: '/admin/settings',
        icon: 'settings',
        permission: PERMISSIONS.settingsRead,
        hint: 'Store, tax, shipping, email, flags',
      },
    ],
  },
];

/** Flat list, for the command palette and breadcrumb lookups. */
export const ADMIN_NAV_FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((section) => section.items);

/**
 * Longest matching prefix wins, so `/admin/products/new` resolves to Products
 * rather than to Dashboard — every admin path starts with `/admin`.
 */
export function findNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;

  for (const item of ADMIN_NAV_FLAT) {
    const base = item.match ?? item.href;
    const matches = pathname === base || pathname.startsWith(`${base}/`);
    if (matches && (!best || base.length > (best.match ?? best.href).length)) best = item;
  }

  return best;
}
