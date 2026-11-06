/**
 * The level the service worker logs an unhandled rejection at. A Serwist
 * strategy that gets neither a network nor a cached response rejects with a
 * SerwistError named `no-response`: routine while a phone is offline or the
 * server restarts, and the page already sees the failed fetch. Anything else
 * is a real fault and stays an error.
 */
export function rejectionLogLevel(reason: unknown): 'debug' | 'error' {
  return reason instanceof Error && reason.name === 'no-response' ? 'debug' : 'error';
}
