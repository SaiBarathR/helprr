// A push subscription's endpoint is a URL this server will POST to, and the
// subscribe route takes it from the request. Left unchecked, a signed-in user
// could register any address and have the server call it.
//
// These are the push services browsers issue endpoints for: FCM for Chrome and
// the other Chromium browsers, Mozilla's autopush for Firefox, Apple's for
// Safari, and Windows Notification Services for Edge. A browser whose service
// is missing here cannot subscribe; the subscribe route logs the host it
// refused so it can be added.
const PUSH_SERVICE_HOSTS = new Set([
  'fcm.googleapis.com',
  'jmt17.google.com',
  'updates.push.services.mozilla.com',
]);
const PUSH_SERVICE_DOMAINS = ['.push.apple.com', '.notify.windows.com'];

// Matched against the raw string rather than a parsed URL: `web-push` parses
// the endpoint with Node's legacy parser, which does not always agree with the
// WHATWG one on where a host ends (a tab or a `;` inside it, for one). This
// shape leaves nothing for two parsers to read differently: https, a plain
// lowercase hostname with no port or credentials, then a path.
const ENDPOINT_RE = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/[\x21-\x7e]*$/;
const MAX_ENDPOINT_LENGTH = 2048;

/** The endpoint's hostname, or null when it is not a plain https URL. */
export function pushEndpointHost(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  return ENDPOINT_RE.exec(endpoint)?.[1] ?? null;
}

export function isPushServiceEndpoint(endpoint: unknown): endpoint is string {
  const host = pushEndpointHost(endpoint);
  return host !== null
    && (PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_DOMAINS.some((domain) => host.endsWith(domain)));
}
