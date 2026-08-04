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

  /*
   * The session shape lives here, not beside the providers.
   *
   * The edge proxy builds its own Auth.js instance from this config alone, and
   * a config without this callback hands it a session whose `user.roles` is
   * undefined — so every role check at the edge silently fails closed and the
   * whole admin 404s for everyone, including a super administrator.
   *
   * It is a pure mapping from token to session with no database access, so it
   * is safe in the edge bundle. `lib/auth/index.ts` spreads these callbacks and
   * adds the `jwt` one, which is not.
   */
  callbacks: {
    session({ session, token }) {
      session.user.id = token.id;
      session.user.sessionId = token.sid ?? null;
      session.user.roles = token.roles ?? [];
      session.user.permissions = token.permissions ?? [];
      session.user.isEmailVerified = token.isEmailVerified ?? false;
      return session;
    },
  },

  // Trust the deployment host header; Vercel sets it correctly.
  trustHost: true,

  providers: [],
} satisfies NextAuthConfig;
