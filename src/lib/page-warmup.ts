// In-app (client-side) navigations fetch RSC payloads, never a document, so
// the service worker's `pages` cache only ever saw the page the app was
// launched on. Offline, a failed RSC fetch falls back to a hard navigation
// that then had nothing cached and got offline.html. The app shell asks the
// worker to cache the document of each page it opens; the worker runs that
// request through the same plugins as a real navigation.
export const CACHE_PAGE_MESSAGE_TYPE = 'helprr-cache-page';

/** Same paths the worker's document-navigation route caches. */
export function isCacheablePagePath(pathname: string): boolean {
  return !pathname.startsWith('/api/') && pathname !== '/invite';
}

/**
 * The document request to cache for a page the app opened, or null for
 * anything that is not a same-origin, cacheable page. `redirect: 'manual'`
 * keeps a redirect (a signed-out session sent to /login) an opaque redirect,
 * which the page cache refuses, instead of caching the login page under
 * this URL.
 */
export function pageWarmupRequest(rawUrl: unknown, origin: string): Request | null {
  if (typeof rawUrl !== 'string') return null;
  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || !isCacheablePagePath(url.pathname)) return null;
  url.hash = '';
  return new Request(url.href, { credentials: 'same-origin', redirect: 'manual' });
}

// Script/style tags name `/_next/static/...`; the inline flight data names the
// route's lazy chunks as `static/chunks/...` (Next adds the prefix at runtime).
const PAGE_ASSET = /(?:\/_next\/)?(static\/(?:chunks|css)\/[^"'\\\s<>]+?\.(?:js|css))(?=["'\\])/g;
// A route names ~20-50; anything past this is not a build's page.
export const MAX_PAGE_ASSETS = 200;

/**
 * The build assets a cached page document loads. A page kept without being
 * rendered (the start URL, the default page) has never loaded its route
 * chunks, so offline it would fail to hydrate unless these are cached too.
 *
 * The document also carries server-rendered text from elsewhere (a TMDB
 * overview, a title), and the worker fetches these with the user's cookies,
 * so a match only counts if it stays a plain same-origin `/_next/static/`
 * file: no `..`, no query or fragment.
 */
export function pageAssetPaths(html: string, origin: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(PAGE_ASSET)) {
    if (paths.size >= MAX_PAGE_ASSETS) break;
    const raw = `/_next/${match[1]}`;
    if (/\.\.|%2e/i.test(raw) || /[?#]/.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin || !url.pathname.startsWith('/_next/static/') || url.search || url.hash) continue;
    paths.add(url.pathname);
  }
  return [...paths];
}

/** Ask the controlling service worker to keep this page for offline use. */
export function warmPageCache(href: string): void {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: CACHE_PAGE_MESSAGE_TYPE, url: href });
  } catch {
    // Offline support is best effort; the page itself is unaffected.
  }
}
