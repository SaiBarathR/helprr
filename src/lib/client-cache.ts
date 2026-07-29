const USER_SCOPED_CACHE_NAMES = ['pages', 'api-readonly', 'api-images'] as const;
const CLEAR_USER_CACHES_MESSAGE = { type: 'helprr-clear-user-caches' } as const;
const AUTH_BOUNDARY_CHANNEL_NAME = 'helprr-authentication-boundary';
const AUTH_BOUNDARY_STORAGE_KEY = 'helprr:authentication-boundary';
const AUTH_BOUNDARY_MESSAGE_TYPE = 'helprr-authentication-boundary';
const CACHE_CLEAR_TIMEOUT_MS = 5_000;
const SESSION_LOGOUT_TIMEOUT_MS = 5_000;

let authBoundaryChannel: BroadcastChannel | null = null;

interface AuthenticationBoundaryMessage {
  type: typeof AUTH_BOUNDARY_MESSAGE_TYPE;
  id: string;
}

export type SessionLogoutResult = 'success' | 'failed' | 'indeterminate';

function getAuthBoundaryChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (authBoundaryChannel) return authBoundaryChannel;
  try {
    return (authBoundaryChannel = new BroadcastChannel(AUTH_BOUNDARY_CHANNEL_NAME));
  } catch {
    return null;
  }
}

function authenticationBoundaryId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // An opaque uniqueness token is enough; this is not a security credential.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseAuthenticationBoundaryMessage(
  value: unknown,
): AuthenticationBoundaryMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as { type?: unknown; id?: unknown };
  if (
    message.type !== AUTH_BOUNDARY_MESSAGE_TYPE
    || typeof message.id !== 'string'
    || message.id.length === 0
    || message.id.length > 256
  ) {
    return null;
  }
  return {
    type: AUTH_BOUNDARY_MESSAGE_TYPE,
    id: message.id,
  };
}

export function broadcastAuthenticationBoundary(): void {
  if (typeof window === 'undefined') return;
  const message: AuthenticationBoundaryMessage = {
    type: AUTH_BOUNDARY_MESSAGE_TYPE,
    id: authenticationBoundaryId(),
  };
  const channel = getAuthBoundaryChannel();
  if (channel) {
    try {
      channel.postMessage(message);
    } catch {
      // The storage transport below remains available.
    }
  }
  // Always publish to both transports. Browser privacy modes and mixed-version
  // tabs can make BroadcastChannel available in one realm but not another.
  try {
    window.localStorage.setItem(AUTH_BOUNDARY_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Cache clearing still protects future navigations in this tab.
  }
}

export function subscribeToAuthenticationBoundaries(
  onBoundary: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const channel = getAuthBoundaryChannel();
  const seenIds = new Set<string>();
  const deliver = (value: unknown) => {
    const message = parseAuthenticationBoundaryMessage(value);
    if (!message || seenIds.has(message.id)) return;
    seenIds.add(message.id);
    // Bound memory even if a realm remains open through many authentication
    // changes. Removing the oldest entry is sufficient for transport dedupe.
    if (seenIds.size > 32) {
      const oldest = seenIds.values().next().value;
      if (oldest) seenIds.delete(oldest);
    }
    onBoundary();
  };
  const channelListener = (event: MessageEvent<unknown>) => deliver(event.data);
  const storageListener = (event: StorageEvent) => {
    if (event.key !== AUTH_BOUNDARY_STORAGE_KEY || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed or unrelated storage events.
    }
  };

  channel?.addEventListener('message', channelListener);
  window.addEventListener('storage', storageListener);
  return () => {
    channel?.removeEventListener('message', channelListener);
    window.removeEventListener('storage', storageListener);
  };
}

export async function requestSessionLogout(): Promise<SessionLogoutResult> {
  if (typeof window === 'undefined') return 'failed';

  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch('/api/auth/logout', {
        method: 'POST',
        signal: controller.signal,
      })
        .then((response): SessionLogoutResult => (
          response.ok ? 'success' : 'failed'
        ))
        // A network error cannot prove whether the server revoked the session.
        .catch((): SessionLogoutResult => 'indeterminate'),
      new Promise<SessionLogoutResult>((resolve) => {
        timeout = globalThis.setTimeout(() => {
          controller.abort();
          resolve('indeterminate');
        }, SESSION_LOGOUT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

async function askWorkerToClearUserCaches(worker: ServiceWorker): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    throw new Error('Cannot confirm user-scoped cache clearing');
  }

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Timed out clearing user-scoped caches')),
      CACHE_CLEAR_TIMEOUT_MS,
    );
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const acknowledgement = event.data as { ok?: unknown } | null;
      finish(
        acknowledgement?.ok === true
          ? undefined
          : new Error('Service worker failed to clear user-scoped caches'),
      );
    };
    channel.port1.start();
    try {
      worker.postMessage(CLEAR_USER_CACHES_MESSAGE, [channel.port2]);
    } catch {
      finish(new Error('Could not request user-scoped cache clearing'));
    }
  });
}

async function withCacheClearTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = globalThis.setTimeout(
          () => reject(new Error('Timed out clearing user-scoped caches')),
          CACHE_CLEAR_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

/**
 * Remove browser/PWA data that can outlive a session. Cache Storage is
 * available to windows as well as service workers, so prefer deleting it
 * directly and await completion before crossing an authentication boundary.
 */
async function clearUserScopedBrowserCachesImpl(): Promise<void> {
  let directClearError: unknown;
  if ('caches' in window) {
    try {
      await Promise.all(USER_SCOPED_CACHE_NAMES.map((name) => window.caches.delete(name)));
      return;
    } catch (error) {
      directClearError = error;
      // Fall back to asking the active worker.
    }
  }

  if (navigator.serviceWorker?.controller) {
    await askWorkerToClearUserCaches(navigator.serviceWorker.controller);
    return;
  }

  const registrations = await navigator.serviceWorker?.getRegistrations();
  const workers = (registrations ?? [])
    .map((registration) => registration.active ?? registration.installing)
    .filter((worker): worker is ServiceWorker => Boolean(worker));
  if (workers.length === 0) {
    if (directClearError instanceof Error) throw directClearError;
    if (directClearError) throw new Error('Could not clear user-scoped caches');
    return;
  }
  await Promise.all(workers.map(askWorkerToClearUserCaches));
}

export async function clearUserScopedBrowserCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  await withCacheClearTimeout(clearUserScopedBrowserCachesImpl());
}
