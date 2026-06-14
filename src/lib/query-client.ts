import { QueryClient, QueryCache, isServer } from '@tanstack/react-query';
import { ApiError } from './query-fetch';

// Canonical App Router pattern: a fresh client per request on the server, a
// stable singleton in the browser. We don't currently prefetch on the server
// (all consumers are 'use client' pages), so the server client is effectively
// unused — but keeping the split is correct and cheap.
function makeQueryClient() {
  return new QueryClient({
    // A session revoked mid-session returns 401 JSON from the API route; the
    // navigation middleware only redirects full navigations, not in-page
    // fetches. Catch it here so a revoked session redirects instead of leaving
    // the page stranded on an error.
    queryCache: new QueryCache({ onError: handleAuthError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000, // baseline; reference hooks raise this, live hooks lower it
        gcTime: 5 * 60_000, // keep data warm so back-navigation paints from cache
        refetchOnWindowFocus: false, // iOS PWA focus churn would hammer the *arr instances
        refetchOnReconnect: true,
        // Local *arr — fast-fail. Never retry a 401 (let the handler above redirect).
        retry: (count, error) =>
          !(error instanceof ApiError && error.status === 401) && count < 1,
      },
      mutations: { retry: 0 },
    },
  });
}

let redirectingToLogin = false;

function handleAuthError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (typeof window === 'undefined') return;
  // Already on /login (or mid-redirect) — don't loop.
  if (redirectingToLogin || window.location.pathname.startsWith('/login')) return;
  redirectingToLogin = true;
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  return (browserQueryClient ??= makeQueryClient());
}
