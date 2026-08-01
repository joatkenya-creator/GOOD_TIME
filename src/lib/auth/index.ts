import { PrismaAdapter } from '@auth/prisma-adapter';
import { headers } from 'next/headers';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

import { ROLES, type Permission, type RoleKey } from '@/constants/permissions';
import { signInSchema } from '@/features/auth/schemas';
import { authConfig } from '@/lib/auth/config';
import { env, integrations } from '@/lib/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/server/auth/password';
import { createSession, recordLogin } from '@/services/account/security.service';
import { mergeGuestCart } from '@/services/cart.service';

/**
 * IP and user agent for the audit trail.
 *
 * Wrapped because Auth.js callbacks can run outside a request scope (a token
 * refresh from a background revalidation), where `headers()` throws. A missing
 * trail is acceptable; a sign-in that fails because of one is not.
 */
async function requestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return {
      // `x-forwarded-for` is a list; the first entry is the client.
      ipAddress: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: list.get('user-agent'),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/** Re-read role grants from the database at most once an hour per session. */
const CLAIMS_TTL_SECONDS = 60 * 60;

interface Claims {
  roles: RoleKey[];
  permissions: Permission[];
  isEmailVerified: boolean;
}

/** Flattens a user's roles into the claim set carried by the JWT. */
async function loadClaims(userId: string): Promise<Claims> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      roles: {
        select: { role: { select: { key: true, permissions: { select: { key: true } } } } },
      },
    },
  });

  if (!user) return { roles: [], permissions: [], isEmailVerified: false };

  const roles = user.roles.map((entry) => entry.role.key as RoleKey);
  const permissions = [
    ...new Set(user.roles.flatMap((entry) => entry.role.permissions.map((p) => p.key))),
  ] as Permission[];

  return { roles, permissions, isEmailVerified: user.emailVerified !== null };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  // The adapter persists OAuth accounts and Auth.js verification tokens. Sessions
  // themselves live in the JWT - see `authConfig.session.strategy`.
  adapter: PrismaAdapter(prisma),

  providers: [
    Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = signInSchema.pick({ email: true, password: true }).safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            status: true,
            firstName: true,
            image: true,
          },
        });

        // `verifyPassword` runs a dummy comparison when there is no hash, so a
        // missing account and a wrong password take the same amount of time.
        const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);

        // Every attempt is written down — the failures are the ones that matter.
        // Three bad passwords from an unfamiliar country is the signal, and it
        // only exists if the failures were recorded.
        const trail = await requestContext();

        if (!user || !valid) {
          await recordLogin({
            email: parsed.data.email,
            outcome: user ? 'BAD_PASSWORD' : 'UNKNOWN_EMAIL',
            userId: user?.id ?? null,
            ...trail,
          });
          return null;
        }

        if (user.status !== 'ACTIVE') {
          logger.warn('Sign-in blocked for non-active account', { userId: user.id });
          await recordLogin({
            email: parsed.data.email,
            outcome: 'LOCKED',
            userId: user.id,
            ...trail,
          });
          return null;
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordLogin({
          email: user.email,
          outcome: 'SUCCESS',
          userId: user.id,
          ...trail,
        });

        return { id: user.id, email: user.email, name: user.firstName, image: user.image };
      },
    }),

    // OAuth is wired but only offered when credentials are present, so the
    // sign-in page never renders a button that cannot work.
    ...(integrations.googleOAuth
      ? [
          Google({
            clientId: env.AUTH_GOOGLE_ID!,
            clientSecret: env.AUTH_GOOGLE_SECRET!,
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);

      // Fresh sign-in, an explicit `update()`, or the claim TTL has elapsed.
      const stale = !token.claimsRefreshedAt || now - token.claimsRefreshedAt > CLAIMS_TTL_SECONDS;

      if (user?.id) token.id = user.id;
      if (!token.id) return token;

      // Fresh sign-in: record the device so it can be listed and revoked later.
      if (user?.id) {
        const context = await requestContext();
        const session = await createSession(user.id, context).catch(() => null);
        if (session) token.sid = session.id;
      }

      /*
       * Revocation is **not** checked here, and that is deliberate.
       *
       * This callback does not run on an ordinary session read. A JWT is
       * self-contained: Auth.js decodes the cookie and calls only `session`,
       * re-running `jwt` on sign-in, on `update()`, or when the token is
       * re-issued. A liveness check placed here therefore fires once, at
       * sign-in, against a session created microseconds earlier — which is
       * exactly what it did until a verification harness caught it.
       *
       * It lives in `getSessionUser` instead: the one funnel every protected
       * page and route handler passes through, memoised per request.
       */

      if (user || trigger === 'update' || stale) {
        const claims = await loadClaims(token.id);
        token.roles = claims.roles;
        token.permissions = claims.permissions;
        token.isEmailVerified = claims.isEmailVerified;
        token.claimsRefreshedAt = now;
      }

      return token;
    },

    session({ session, token }) {
      session.user.id = token.id;
      session.user.sessionId = token.sid ?? null;
      session.user.roles = token.roles ?? [];
      session.user.permissions = token.permissions ?? [];
      session.user.isEmailVerified = token.isEmailVerified ?? false;
      return session;
    },
  },

  events: {
    /**
     * Every new account gets the CUSTOMER role. Doing this on `createUser` covers
     * both the credentials path and every OAuth provider we add later.
     */
    async createUser({ user }) {
      if (!user.id) return;

      const customerRole = await prisma.role.findUnique({ where: { key: ROLES.customer } });
      if (!customerRole) {
        logger.error('CUSTOMER role missing - run `npm run db:seed`', undefined, {
          userId: user.id,
        });
        return;
      }

      await prisma.userRole.create({ data: { userId: user.id, roleId: customerRole.id } });
    },

    /**
     * Folds a guest cart into the account cart.
     *
     * Here rather than in the sign-in page, so it happens on every path in —
     * credentials, OAuth, and the magic link we may add later. A merge that only
     * one route performs is a merge that silently stops working when someone adds
     * the second route.
     *
     * Never allowed to block the sign-in: a failed merge costs a cart, a thrown
     * error costs the session.
     */
    async signIn({ user }) {
      if (!user.id) return;

      try {
        await mergeGuestCart(user.id);
      } catch (error) {
        logger.error('cart.merge_failed', error, { userId: user.id });
      }
    },
  },
});
