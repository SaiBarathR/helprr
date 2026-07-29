export function isImageResponseCacheable(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.headers.get('x-helprr-cache') === 'BYPASS') return false;
  return !/(?:^|,)\s*(?:[^,;]+\s*;\s*)?no-store(?:\s|,|$)/i.test(
    response.headers.get('cache-control') ?? '',
  );
}
