'use client';

import { getQueryClient } from '@/lib/query-client';
import { invalidateExternalUrls } from '@/lib/hooks/use-external-urls';
import {
  broadcastAuthenticationBoundary,
  clearUserScopedBrowserCaches,
  requestSessionLogout,
} from '@/lib/client-cache';

const DEVICE_COOKIE = 'helprr-device';
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Which dashboard layout the server renders for this device. */
export function writeDeviceCookie(device: 'desktop' | 'mobile'): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Browsers reject Secure cookies over plain HTTP (except localhost), so omit
  // the flag on http:// origins — LAN-hosted self-hosted instances need this.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${DEVICE_COOKIE}=${device}; Path=/; SameSite=Lax${secure}; Max-Age=${DEVICE_COOKIE_MAX_AGE}`;
}

export function setDeviceCookieFromMatchMedia(): void {
  if (typeof window === 'undefined') return;
  writeDeviceCookie(window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop');
}

/**
 * Everything the browser must do once the server has issued a new session (a
 * sign-in, or the first admin created in /setup), before entering the app.
 * Throws, after rolling the session back, when the previous identity's browser
 * data could not be cleared.
 */
export async function completeBrowserSignIn(): Promise<void> {
  // Re-read device class right before redirect in case the user resized
  // the window between mount and login.
  setDeviceCookieFromMatchMedia();
  // Drop any in-memory TanStack cache from a prior session before entering
  // the app — the browser QueryClient is a persistent singleton, so without
  // this a different user signing in on the same browser could briefly see
  // the previous user's cached lists/sessions/widgets.
  getQueryClient().clear();
  invalidateExternalUrls();
  // The successful response changed the origin-wide cookie. Notify other
  // tabs immediately so their mounted state cannot keep running under the
  // newly authenticated identity while persistent caches are cleared.
  broadcastAuthenticationBoundary();
  try {
    await clearUserScopedBrowserCaches();
  } catch {
    // The server already issued a session. Roll it back and stay on the
    // login screen rather than entering the app with another user's
    // persistent browser caches still available.
    const rollbackResult = await requestSessionLogout();
    // Rollback is itself an origin-wide authentication boundary. Broadcast
    // even when it cannot be confirmed so every other tab reloads instead
    // of retaining state from whichever identity its cookie now represents.
    broadcastAuthenticationBoundary();
    if (rollbackResult !== 'success') {
      throw new Error(
        'Browser data could not be cleared and sign-in rollback could not be confirmed. Close this browser and revoke the session before retrying.',
      );
    }
    throw new Error('Could not safely clear browser data. Please retry.');
  }
}
