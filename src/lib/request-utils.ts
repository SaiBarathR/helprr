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
