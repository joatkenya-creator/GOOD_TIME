/**
 * Capability keys. Roles are bags of these; code checks the capability, never the
 * role name, so a new role never requires touching an authorisation call site.
 */
export const PERMISSIONS = {
  productRead: 'product:read',
  productWrite: 'product:write',
  productDelete: 'product:delete',
  orderRead: 'order:read',
  orderWrite: 'order:write',
  orderRefund: 'order:refund',
  customerRead: 'customer:read',
  customerWrite: 'customer:write',
  contentRead: 'content:read',
  contentWrite: 'content:write',
  reviewModerate: 'review:moderate',
  couponWrite: 'coupon:write',
  importRun: 'import:run',
  settingsWrite: 'settings:write',
  analyticsRead: 'analytics:read',
  auditRead: 'audit:read',
  roleAssign: 'role:assign',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLES = {
  customer: 'CUSTOMER',
  admin: 'ADMIN',
  superAdmin: 'SUPER_ADMIN',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Seed definition for the role table. `prisma/seed.ts` is the only consumer;
 * runtime checks read the database so grants can be edited without a deploy.
 */
export const ROLE_DEFINITIONS: Record<
  RoleKey,
  { name: string; description: string; permissions: readonly Permission[] }
> = {
  [ROLES.customer]: {
    name: 'Customer',
    description: 'Default role for every registered shopper.',
    permissions: [],
  },
  [ROLES.admin]: {
    name: 'Administrator',
    description: 'Day-to-day store operations. Cannot manage roles or settings.',
    permissions: [
      PERMISSIONS.productRead,
      PERMISSIONS.productWrite,
      PERMISSIONS.orderRead,
      PERMISSIONS.orderWrite,
      PERMISSIONS.customerRead,
      PERMISSIONS.contentRead,
      PERMISSIONS.contentWrite,
      PERMISSIONS.reviewModerate,
      PERMISSIONS.couponWrite,
      PERMISSIONS.analyticsRead,
    ],
  },
  [ROLES.superAdmin]: {
    name: 'Super administrator',
    description: 'Unrestricted access, including roles, settings and imports.',
    permissions: ALL_PERMISSIONS,
  },
};

/** Roles that grant access to the admin surface. */
export const ADMIN_ROLES: readonly RoleKey[] = [ROLES.admin, ROLES.superAdmin];
