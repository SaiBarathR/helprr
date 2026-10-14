'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getQueryClient, holdLoginRedirect } from '@/lib/query-client';
import { invalidateExternalUrls } from '@/lib/hooks/use-external-urls';
import { broadcastAuthenticationBoundary, clearUserScopedBrowserCaches } from '@/lib/client-cache';

/**
 * What a page does once this browser's own session has ended (Account sign-out,
 * or revoking the current session from Sessions): drop the in-memory query
 * cache, tell other tabs, then clear the user-scoped Cache Storage behind a
 * neutral screen and only then go to Login. A failed clear stops on an error
 * screen instead of navigating, so the next user never sees this one's data.
 */
export function useAuthenticationBoundary() {
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const clearStarted = useRef(false);

  useEffect(() => {
    if (!active || clearStarted.current) return;
    clearStarted.current = true;
    // Start only after the neutral boundary screen commits, matching the
    // cross-tab path in QueryProvider.
    void clearUserScopedBrowserCaches()
      .then(() => window.location.replace('/login'))
      .catch(() => setFailed(true));
  }, [active]);

  const begin = useCallback(() => {
    holdLoginRedirect();
    setActive(true);
    // Drop the in-memory TanStack cache so a different user signing in on this
    // device can't see this session's cached data (the QueryClient is a
    // persistent browser singleton). Login also clears, as a backstop.
    getQueryClient().clear();
    invalidateExternalUrls();
    // The server has cleared the origin-wide cookie. Notify other tabs before
    // touching Cache Storage so they cannot keep mounted authenticated state
    // if the browser cache operation stalls or fails.
    broadcastAuthenticationBoundary();
  }, []);

  return { active, failed, begin };
}

export function AuthenticationBoundaryScreen({ failed }: { failed: boolean }) {
  return (
    <main className="min-h-[50vh] flex items-center justify-center p-6">
      <p className="max-w-md text-center text-sm text-muted-foreground" role="status">
        {failed
          ? 'Browser data could not be cleared. Clear this site’s browser data, then reload.'
          : 'Securing this browser session…'}
      </p>
    </main>
  );
}
