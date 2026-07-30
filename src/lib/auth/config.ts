import type { NextAuthConfig } from 'next-auth';

import { ROUTES } from '@/constants/routes';

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * `middleware.ts` runs on the Edge runtime, where Prisma and bcrypt cannot run.
 * Splitting the config means middleware can read and validate the session JWT
 * without dragging the database adapter into the edge bundle — the standard
 * Auth.js v5 pattern.
 *
 * Providers and the adapter live in `./index.ts`, which is Node-only.
 */
export const authConfig = {
  session: {
    // Required by the credentials provider, and it keeps session reads free.
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the cookie at most once a day
  },

  pages: {
    signIn: ROUTES.auth.signIn,
    error: ROUTES.auth.signIn,
    verifyRequest: ROUTES.auth.verifyEmail,
    newUser: ROUTES.account.root,
  },

  // Trust the deployment host header; Vercel sets it correctly.
  trustHost: true,

  providers: [],
} satisfies NextAuthConfig;
