import type { DefaultSession } from 'next-auth';

import type { Permission, RoleKey } from '@/constants/permissions';

/**
 * Session shape.
 *
 * Roles and permissions are flattened into the JWT at sign-in so authorisation
 * checks in middleware and layouts cost nothing — no database round trip on the
 * hot path. The trade-off is staleness: a revoked role stays effective until the
 * token refreshes, which `CLAIMS_TTL_SECONDS` in `src/lib/auth/index.ts` bounds.
 *
 * The claim is `isEmailVerified` rather than `emailVerified` because Auth.js
 * already defines the latter as `Date | null` on its adapter user; reusing the
 * name would collide.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      roles: RoleKey[];
      permissions: Permission[];
      isEmailVerified: boolean;
      /**
       * The `UserSession` row backing this token.
       *
       * Lets the security page mark which device in the list is the one reading
       * it, and lets "sign out everywhere else" spare the current one.
       */
      sessionId: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    roles?: RoleKey[];
    permissions?: Permission[];
  }
}

/**
 * Auth.js v5 re-exports the JWT type from `@auth/core/jwt`, so both specifiers
 * must be augmented: `next-auth/jwt` for our own imports, and the core module
 * for the type the callbacks actually receive.
 */
declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    roles: RoleKey[];
    permissions: Permission[];
    isEmailVerified: boolean;
    /** Unix seconds at which claims were last refreshed from the database. */
    claimsRefreshedAt: number;
    /**
     * The `UserSession` row backing this token.
     *
     * Lets a customer see and revoke individual devices, which a stateless token
     * cannot express on its own.
     */
    sid?: string;
    /** When the session was last confirmed live. See `SESSION_LIVENESS_SECONDS`. */
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    roles: RoleKey[];
    permissions: Permission[];
    isEmailVerified: boolean;
    claimsRefreshedAt: number;
    /**
     * The `UserSession` row backing this token.
     *
     * Lets a customer see and revoke individual devices, which a stateless token
     * cannot express on its own.
     */
    sid?: string;
    /** When the session was last confirmed live. See `SESSION_LIVENESS_SECONDS`. */
  }
}
