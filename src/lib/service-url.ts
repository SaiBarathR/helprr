/**
 * A service connection's URL in the form two of them are compared in.
 *
 * Shared by the server, which reuses a saved secret only for the URL it was
 * saved with, and the settings form, which has to predict that. Safe to import
 * on the client.
 */
export function normalizeServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * The URL with `http://` in front when it has no scheme, so `192.168.1.10:8989`
 * works as typed. Safe to import on the client.
 */
export function withDefaultScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * A page of the service itself (for example its API key settings) under the
 * address typed in the form, or null unless that is a real http(s) URL.
 */
export function servicePageUrl(url: string, path: string | null): string | null {
  if (!path) return null;
  try {
    const parsed = new URL(withDefaultScheme(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Docker's name for the host machine: no browser elsewhere can open it.
    if (parsed.hostname.toLowerCase() === 'host.docker.internal') return null;
    // Origin and path only: a typed query, fragment or user:password must not end up in the link.
    let base = normalizeServiceUrl(parsed.origin + parsed.pathname);
    // An address copied from inside the app already ends in that page (or in
    // Jellyfin's /web); don't repeat it.
    const pagePath = path.split('#')[0].replace(/\/+$/, '');
    if (pagePath && base.endsWith(pagePath)) base = base.slice(0, -pagePath.length);
    else if (pagePath.startsWith('/web') && /\/web(\/index\.html)?$/.test(base)) base = base.replace(/\/web(\/index\.html)?$/, '');
    return `${base}${path}`;
  } catch {
    return null;
  }
}
