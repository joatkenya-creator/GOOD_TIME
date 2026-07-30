/**
 * Every internal URL in one place. Typos become type errors, and a URL change is
 * a one-line edit instead of a repo-wide search.
 */
export const ROUTES = {
  home: '/',
  shop: '/shop',
  search: '/search',
  collections: '/collections',
  brands: '/brands',
  /** Content hub. Buying guides are how this category earns organic search. */
  blog: '/guides',
  cart: '/cart',
  checkout: '/checkout',

  product: (slug: string) => `/products/${slug}`,
  category: (slug: string) => `/shop/${slug}`,
  collection: (slug: string) => `/collections/${slug}`,
  brand: (slug: string) => `/brands/${slug}`,
  post: (slug: string) => `/guides/${slug}`,
  page: (slug: string) => `/pages/${slug}`,

  auth: {
    signIn: '/sign-in',
    register: '/register',
    forgotPassword: '/forgot-password',
    resetPassword: '/reset-password',
    verifyEmail: '/verify-email',
    signOut: '/api/auth/signout',
  },

  account: {
    root: '/account',
    orders: '/account/orders',
    order: (orderNumber: string) => `/account/orders/${orderNumber}`,
    addresses: '/account/addresses',
    wishlist: '/account/wishlist',
    settings: '/account/settings',
  },

  admin: {
    root: '/admin',
    products: '/admin/products',
    orders: '/admin/orders',
    customers: '/admin/customers',
    content: '/admin/content',
    settings: '/admin/settings',
  },

  api: {
    auth: '/api/auth',
    products: '/api/products',
    orders: '/api/orders',
    users: '/api/users',
    cart: '/api/cart',
    checkout: '/api/checkout',
    search: '/api/search',
    admin: '/api/admin',
    analytics: '/api/analytics',
    blog: '/api/blog',
    health: '/api/health',
  },
} as const;

/** Prefixes that require an authenticated session. */
export const PROTECTED_PREFIXES = ['/account', '/admin'] as const;

/** Prefixes that require an administrator role. */
export const ADMIN_PREFIXES = ['/admin', '/api/admin'] as const;

/** Auth pages an already-signed-in visitor should be bounced away from. */
export const GUEST_ONLY_PREFIXES = ['/sign-in', '/register', '/forgot-password'] as const;
