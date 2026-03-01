export type ImageServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'jellyfin';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function toCachedImageSrc(
  src: string | null | undefined,
  serviceHint?: ImageServiceHint
): string | null {
  if (!src) return null;

  if (!isHttpUrl(src)) {
    return src;
  }

  try {
    const parsed = new URL(src);
    if (parsed.pathname === '/api/image' || parsed.pathname === '/api/jellyfin/image') {
      return src;
    }

    const params = new URLSearchParams({ src });
    if (serviceHint) {
      params.set('service', serviceHint);
    }
    return `/api/image?${params.toString()}`;
  } catch {
    return src;
  }
}

export function isProtectedApiImageSrc(src: string): boolean {
  try {
    const parsed = new URL(src, 'http://localhost');
    return parsed.pathname === '/api/jellyfin/image' || parsed.pathname === '/api/image';
  } catch {
    return false;
  }
}
