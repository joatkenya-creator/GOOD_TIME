'use client';

import { QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * TanStack Query configuration.
 *
 * Server Components handle the initial data for every page, so Query is used
 * only for genuinely client-driven state: infinite scroll on listings, live
 * inventory checks, cart mutations, the search-as-you-type box.
 *
 * `staleTime` of 60s is the important setting — the default of 0 refetches on
 * every mount and every window focus, which at our traffic is a lot of pointless
 * load on the origin.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        // Retrying a 404 or a 403 just delays the error the user needs to see.
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: 0 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  // A fresh client per server request; a single shared client in the browser.
  if (isServer) return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // `useState` rather than a module-level constant: React may render this twice
  // in Strict Mode, and a suspended render must not discard an in-flight client.
  const [queryClient] = useState(getQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
