export function isImageResponseCacheable(response: Response): boolean {
  if (response.status !== 200) return false;
  const serverCacheStatus = response.headers.get('x-helprr-cache');
  if (serverCacheStatus === 'BYPASS' || serverCacheStatus === 'STALE') return false;
  return !/(?:^|,)\s*(?:[^,;]+\s*;\s*)?no-store(?:\s|,|$)/i.test(
    response.headers.get('cache-control') ?? '',
  );
}

// Upstream answers that mean the image will not load (missing, too large, not a
// supported raster), as opposed to an outage worth retrying. The server keeps a
// short negative entry per cache key and the browser may reuse the error for the
// same time, so a broken poster is not refetched upstream on every render.
export const IMAGE_NEGATIVE_CACHE_STATUSES: ReadonlySet<number> = new Set([404, 413, 415]);
export const IMAGE_NEGATIVE_CACHE_TTL_SECONDS = 600;
