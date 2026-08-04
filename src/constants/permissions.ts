/**
 * Capability keys. Roles are bags of these; code checks the capability, never the
 * role name, so a new role never requires touching an authorisation call site.
 *
 * Read, write and delete are separated because the interesting mistakes live
 * between them: a support agent who can read every order but refund none, a
 * marketing manager who can publish a campaign but not change a price.
 */
export const PERMISSIONS = {
  // --- Catalogue ---------------------------------------------------------
  productRead: 'product:read',
  productWrite: 'product:write',
  productDelete: 'product:delete',
  productPublish: 'product:publish',
  /** Bulk edits touch hundreds of rows from one click. Held separately. */
  productBulk: 'product:bulk',
  categoryWrite: 'category:write',
  collectionWrite: 'collection:write',
  mediaRead: 'media:read',
  mediaWrite: 'media:write',
  mediaDelete: 'media:delete',

  // --- Inventory ---------------------------------------------------------
  inventoryRead: 'inventory:read',
  /** Changing counts is how shrinkage gets hidden, so it is its own grant. */
  inventoryAdjust: 'inventory:adjust',

  // --- Orders ------------------------------------------------------------
  orderRead: 'order:read',
  orderWrite: 'order:write',
  orderFulfil: 'order:fulfil',
  orderCancel: 'order:cancel',
  /** Moves money out of the business. Never bundled with order:write. */
  orderRefund: 'order:refund',
  returnManage: 'return:manage',

  // --- Customers ---------------------------------------------------------
  customerRead: 'customer:read',
  customerWrite: 'customer:write',
  /** Suspending or deleting an account, distinct from editing one. */
  customerSuspend: 'customer:suspend',
  /** Addresses and phone numbers in full. Without it they render masked. */
  customerPii: 'customer:pii',

  // --- Marketing ---------------------------------------------------------
  couponRead: 'coupon:read',
  couponWrite: 'coupon:write',
  /** Issues spendable value out of nothing. Finance-adjacent. */
  creditIssue: 'credit:issue',
  campaignWrite: 'campaign:write',

  // --- Content -----------------------------------------------------------
  contentRead: 'content:read',
  contentWrite: 'content:write',
  contentPublish: 'content:publish',
  blogWrite: 'blog:write',
  blogPublish: 'blog:publish',
  reviewModerate: 'review:moderate',
  seoWrite: 'seo:write',

  // --- Platform ----------------------------------------------------------
  analyticsRead: 'analytics:read',
  reportExport: 'report:export',
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  auditRead: 'audit:read',
  roleAssign: 'role:assign',
  /** Creating or editing roles themselves — the keys to the kingdom. */
  roleManage: 'role:manage',
  importRun: 'import:run',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Human-readable labels, grouped for the role editor.
 *
 * A permission list is only useful to whoever assigns it if the entries read as
 * sentences rather than as keys. `hint` carries the consequence, because the
 * dangerous grants are the ones whose names sound routine.
 */
export const PERMISSION_GROUPS: {
  group: string;
  description: string;
  permissions: { key: Permission; label: string; hint?: string }[];
}[] = [
  {
    group: 'Catalogue',
    description: 'Products, categories, collections and media.',
    permissions: [
      { key: PERMISSIONS.productRead, label: 'View products' },
      { key: PERMISSIONS.productWrite, label: 'Create and edit products' },
      { key: PERMISSIONS.productPublish, label: 'Publish and schedule products' },
      { key: PERMISSIONS.productDelete, label: 'Delete and archive products' },
      {
        key: PERMISSIONS.productBulk,
        label: 'Run bulk product actions',
        hint: 'One click can change hundreds of rows, including prices.',
      },
      { key: PERMISSIONS.categoryWrite, label: 'Manage categories' },
      { key: PERMISSIONS.collectionWrite, label: 'Manage collections' },
      { key: PERMISSIONS.mediaRead, label: 'View the media library' },
      { key: PERMISSIONS.mediaWrite, label: 'Upload and edit media' },
      { key: PERMISSIONS.mediaDelete, label: 'Delete media' },
    ],
  },
  {
    group: 'Inventory',
    description: 'Stock levels and adjustments.',
    permissions: [
      { key: PERMISSIONS.inventoryRead, label: 'View stock levels' },
      {
        key: PERMISSIONS.inventoryAdjust,
        label: 'Adjust stock',
        hint: 'Every adjustment is logged with a reason and an actor.',
      },
    ],
  },
  {
    group: 'Orders',
    description: 'Fulfilment, cancellations and money going back out.',
    permissions: [
      { key: PERMISSIONS.orderRead, label: 'View orders' },
      { key: PERMISSIONS.orderWrite, label: 'Edit orders and add notes' },
      { key: PERMISSIONS.orderFulfil, label: 'Fulfil and ship orders' },
      { key: PERMISSIONS.orderCancel, label: 'Cancel orders' },
      {
        key: PERMISSIONS.orderRefund,
        label: 'Issue refunds',
        hint: 'Moves money out of the business.',
      },
      { key: PERMISSIONS.returnManage, label: 'Manage returns' },
    ],
  },
  {
    group: 'Customers',
    description: 'Accounts and the personal data attached to them.',
    permissions: [
      { key: PERMISSIONS.customerRead, label: 'View customers' },
      { key: PERMISSIONS.customerWrite, label: 'Edit customers, notes and tags' },
      {
        key: PERMISSIONS.customerPii,
        label: 'View full personal details',
        hint: 'Addresses and phone numbers. Without this they appear masked.',
      },
      { key: PERMISSIONS.customerSuspend, label: 'Suspend or delete accounts' },
    ],
  },
  {
    group: 'Marketing',
    description: 'Discounts, credit and campaigns.',
    permissions: [
      { key: PERMISSIONS.couponRead, label: 'View coupons' },
      { key: PERMISSIONS.couponWrite, label: 'Create and edit coupons' },
      {
        key: PERMISSIONS.creditIssue,
        label: 'Issue store credit and gift cards',
        hint: 'Creates spendable value. Treated as a finance permission.',
      },
      { key: PERMISSIONS.campaignWrite, label: 'Manage campaigns and referrals' },
    ],
  },
  {
    group: 'Content',
    description: 'Pages, blog, reviews and search metadata.',
    permissions: [
      { key: PERMISSIONS.contentRead, label: 'View content' },
      { key: PERMISSIONS.contentWrite, label: 'Edit pages, banners and menus' },
      { key: PERMISSIONS.contentPublish, label: 'Publish content' },
      { key: PERMISSIONS.blogWrite, label: 'Write blog posts' },
      { key: PERMISSIONS.blogPublish, label: 'Publish blog posts' },
      { key: PERMISSIONS.reviewModerate, label: 'Moderate reviews' },
      { key: PERMISSIONS.seoWrite, label: 'Manage SEO and redirects' },
    ],
  },
  {
    group: 'Platform',
    description: 'Reporting, configuration and who can do what.',
    permissions: [
      { key: PERMISSIONS.analyticsRead, label: 'View reports' },
      { key: PERMISSIONS.reportExport, label: 'Export reports' },
      { key: PERMISSIONS.settingsRead, label: 'View settings' },
      { key: PERMISSIONS.settingsWrite, label: 'Change settings' },
      { key: PERMISSIONS.auditRead, label: 'Read the audit log' },
      { key: PERMISSIONS.roleAssign, label: 'Assign roles to staff' },
      {
        key: PERMISSIONS.roleManage,
        label: 'Create and edit roles',
        hint: 'Whoever holds this can grant themselves anything else.',
      },
      { key: PERMISSIONS.importRun, label: 'Run imports' },
    ],
  },
];

export const ROLES = {
  customer: 'CUSTOMER',
  superAdmin: 'SUPER_ADMIN',
  admin: 'ADMIN',
  storeManager: 'STORE_MANAGER',
  inventoryManager: 'INVENTORY_MANAGER',
  orderManager: 'ORDER_MANAGER',
  customerSupport: 'CUSTOMER_SUPPORT',
  marketingManager: 'MARKETING_MANAGER',
  contentEditor: 'CONTENT_EDITOR',
  financeManager: 'FINANCE_MANAGER',
  analyst: 'READ_ONLY_ANALYST',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

const P = PERMISSIONS;
const ALL_PERMISSIONS = Object.values(P);

/**
 * Inheritance, expressed as composition rather than as a hierarchy.
 *
 * A tree ("manager inherits from editor") looks tidy until the first role that
 * needs most of a parent but not one dangerous piece of it — and then the tree
 * either grows an exception mechanism or the role quietly gets the permission
 * anyway. Naming the bundles instead keeps every grant explicit and greppable.
 */
const CATALOGUE_VIEW = [P.productRead, P.mediaRead, P.inventoryRead] as const;

const CATALOGUE_EDIT = [
  ...CATALOGUE_VIEW,
  P.productWrite,
  P.productPublish,
  P.productBulk,
  P.categoryWrite,
  P.collectionWrite,
  P.mediaWrite,
] as const;

const ORDER_DESK = [P.orderRead, P.orderWrite, P.orderFulfil, P.customerRead] as const;

const CONTENT_DESK = [
  P.contentRead,
  P.contentWrite,
  P.blogWrite,
  P.mediaRead,
  P.mediaWrite,
  P.seoWrite,
] as const;

/**
 * Seed definition for the role table. `prisma/seed.ts` is the only consumer;
 * runtime checks read the database, so grants can be edited in the role editor
 * without a deploy — and custom roles created there are equal citizens.
 */
export const ROLE_DEFINITIONS: Record<
  RoleKey,
  { name: string; description: string; permissions: readonly Permission[] }
> = {
  [ROLES.customer]: {
    name: 'Customer',
    description: 'Default role for every registered shopper. No admin access.',
    permissions: [],
  },

  [ROLES.superAdmin]: {
    name: 'Super administrator',
    description: 'Unrestricted, including roles and settings. Keep the count low.',
    permissions: ALL_PERMISSIONS,
  },

  [ROLES.admin]: {
    name: 'Administrator',
    description: 'Runs the store day to day. Cannot manage roles or change settings.',
    permissions: [
      ...CATALOGUE_EDIT,
      P.productDelete,
      P.mediaDelete,
      P.inventoryAdjust,
      ...ORDER_DESK,
      P.orderCancel,
      P.orderRefund,
      P.returnManage,
      P.customerWrite,
      P.customerPii,
      P.couponRead,
      P.couponWrite,
      P.campaignWrite,
      ...CONTENT_DESK,
      P.contentPublish,
      P.blogPublish,
      P.reviewModerate,
      P.analyticsRead,
      P.reportExport,
      P.settingsRead,
      P.auditRead,
    ],
  },

  [ROLES.storeManager]: {
    name: 'Store manager',
    description: 'Merchandising and trading. No refunds, no customer PII, no settings.',
    permissions: [
      ...CATALOGUE_EDIT,
      P.inventoryAdjust,
      P.orderRead,
      P.orderWrite,
      P.orderFulfil,
      P.customerRead,
      P.couponRead,
      P.couponWrite,
      P.contentRead,
      P.contentWrite,
      P.reviewModerate,
      P.analyticsRead,
      P.reportExport,
    ],
  },

  [ROLES.inventoryManager]: {
    name: 'Inventory manager',
    description: 'Stock and product data. Cannot see orders or customers.',
    permissions: [
      ...CATALOGUE_VIEW,
      P.productWrite,
      P.productBulk,
      P.inventoryAdjust,
      P.mediaWrite,
      P.analyticsRead,
      P.reportExport,
    ],
  },

  [ROLES.orderManager]: {
    name: 'Order manager',
    description: 'Fulfilment and returns, including refunds.',
    permissions: [
      ...ORDER_DESK,
      P.orderCancel,
      P.orderRefund,
      P.returnManage,
      P.customerPii,
      P.productRead,
      P.inventoryRead,
      P.analyticsRead,
    ],
  },

  [ROLES.customerSupport]: {
    name: 'Customer support',
    description: 'Answers customers. Reads orders, cannot refund or change prices.',
    permissions: [
      P.orderRead,
      P.orderWrite,
      P.customerRead,
      P.customerWrite,
      P.customerPii,
      P.returnManage,
      P.productRead,
      P.inventoryRead,
      P.reviewModerate,
    ],
  },

  [ROLES.marketingManager]: {
    name: 'Marketing manager',
    description: 'Campaigns, discounts and content. Cannot issue store credit.',
    permissions: [
      P.productRead,
      P.collectionWrite,
      P.couponRead,
      P.couponWrite,
      P.campaignWrite,
      ...CONTENT_DESK,
      P.contentPublish,
      P.blogPublish,
      P.customerRead,
      P.analyticsRead,
      P.reportExport,
    ],
  },

  [ROLES.contentEditor]: {
    name: 'Content editor',
    description: 'Writes and edits. Publishing is a separate grant they do not hold.',
    permissions: [...CONTENT_DESK, P.productRead],
  },

  [ROLES.financeManager]: {
    name: 'Finance manager',
    description: 'Money: refunds, store credit, reports and exports.',
    permissions: [
      P.orderRead,
      P.orderRefund,
      P.returnManage,
      P.customerRead,
      P.customerPii,
      P.creditIssue,
      P.couponRead,
      P.analyticsRead,
      P.reportExport,
      P.settingsRead,
      P.auditRead,
    ],
  },

  [ROLES.analyst]: {
    name: 'Read-only analyst',
    description: 'Sees everything operational, changes nothing. No customer PII.',
    permissions: [
      P.productRead,
      P.inventoryRead,
      P.orderRead,
      P.customerRead,
      P.couponRead,
      P.contentRead,
      P.mediaRead,
      P.analyticsRead,
      P.reportExport,
    ],
  },
};

/**
 * Roles that reach the admin surface.
 *
 * Derived, not hand-listed: any role holding at least one permission is a staff
 * role. Maintaining this by hand is how a new role ends up with a full
 * permission set and a locked front door — or worse, the reverse.
 */
export const ADMIN_ROLES: readonly RoleKey[] = (Object.keys(ROLE_DEFINITIONS) as RoleKey[]).filter(
  (role) => ROLE_DEFINITIONS[role].permissions.length > 0,
);

/**
 * Holding any one of these means "you may open the admin at all".
 *
 * The front door checks this; each page then gates itself on the specific
 * permission it needs. Two layers, because a single check at the door means
 * every future page is protected by whoever remembers to protect it.
 */
export const ADMIN_ENTRY_PERMISSIONS: readonly Permission[] = [
  P.productRead,
  P.orderRead,
  P.customerRead,
  P.contentRead,
  P.mediaRead,
  P.inventoryRead,
  P.couponRead,
  P.analyticsRead,
  P.settingsRead,
  P.auditRead,
];
