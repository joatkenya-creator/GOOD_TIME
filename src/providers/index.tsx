'use client';

import { SessionProvider } from 'next-auth/react';

import { QueryProvider } from '@/providers/query-provider';

/**
 * Single client-side provider tree, mounted once in the root layout.
 *
 * Keeping it in one component means adding a provider later (cart, toasts,
 * feature flags) does not mean editing a server component and accidentally
 * turning the whole page into a client component.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
