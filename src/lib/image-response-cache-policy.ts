export function isImageResponseCacheable(response: Response): boolean {
  if (response.status !== 200) return false;
  const serverCacheStatus = response.headers.get('x-helprr-cache');
  if (serverCacheStatus === 'BYPASS' || serverCacheStatus === 'STALE') return false;
  return !/(?:^|,)\s*(?:[^,;]+\s*;\s*)?no-store(?:\s|,|$)/i.test(
    response.headers.get('cache-control') ?? '',
  );
}
