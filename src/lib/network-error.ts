/** A request that never got a response: the device is offline, or on Wi-Fi with no route to Helprr. */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Network request failed', { cause });
    this.name = 'OfflineError';
  }
}

/**
 * fetch() that marks a request that never reached the server. fetch() rejects
 * only for that (or an abort, passed through as is), but the wording differs by
 * browser, and in the installed PWA it is the service worker's failure that
 * surfaces, so the error text can't be relied on. An HTTP error still resolves,
 * so a page keeps its "check Settings" hint for those.
 */
export async function fetchOrOffline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new OfflineError(error);
  }
}

/** Whether a failed request means "offline" rather than a server or config error. */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error instanceof OfflineError;
}
