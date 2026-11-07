import type { NextRequest } from 'next/server';

export function isHttpsRequest(request: NextRequest, trustProxy = false): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  if (!trustProxy) return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return false;
}

// Accept a bare http(s) origin only: no credentials, path, query or fragment.
export function parseBareOrigin(value: string, requireHttps: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && (requireHttps || url.protocol !== 'http:')) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

/**
 * The configured APP_ORIGIN as a bare origin (https only in production), or
 * null when it is unset or invalid. Links Helprr hands out (calendar feeds,
 * invite and reset links) use it, so a link made from a LAN http address
 * still points at the public one; with null the page uses its own address.
 */
export function configuredAppOrigin(): string | null {
  return parseBareOrigin(process.env.APP_ORIGIN?.trim() ?? '', process.env.NODE_ENV === 'production');
}

/** APP_ORIGIN is set but is not an origin configuredAppOrigin() accepts. */
export function isAppOriginInvalid(): boolean {
  return Boolean(process.env.APP_ORIGIN?.trim()) && configuredAppOrigin() === null;
}

export const INVALID_APP_ORIGIN_LINK_ERROR =
  'APP_ORIGIN is set but is not a valid address (https in production), so no link was made. Fix APP_ORIGIN and try again.';

/**
 * The origin Helprr is reached at, for OAuth redirect URIs and the redirects
 * that follow a callback. In production this is only the configured HTTPS
 * APP_ORIGIN; null means it is missing or invalid, and callers must fail
 * rather than fall back to request headers. In development it is the request
 * URL's origin, or the forwarded host and protocol when TRUST_FORWARDED_PROTO
 * says a proxy sets them and they form exactly one valid origin.
 */
export function resolvePublicAppOrigin(request: NextRequest): string | null {
  if (process.env.NODE_ENV === 'production') {
    const configured = process.env.APP_ORIGIN?.trim();
    return configured ? parseBareOrigin(configured, true) : null;
  }

  if (process.env.TRUST_FORWARDED_PROTO === 'true') {
    const proto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase();
    const host = request.headers.get('x-forwarded-host')?.trim();
    // A bare host[:port] only: URL parsing would accept "host/path" or
    // "name@host" and quietly turn them into some other origin.
    const bareHost = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
    if (proto && host && /^https?$/.test(proto) && bareHost.test(host)) {
      const forwarded = parseBareOrigin(`${proto}://${host}`, false);
      if (forwarded) return forwarded;
    }
  }
  return request.nextUrl.origin;
}
