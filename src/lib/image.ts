export type ImageServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'jellyfin' | 'anilist' | 'lidarr';

// Cache-busting token mirrored from the server-side cache generation
// (`getCacheGeneration()`). Appended to proxied image URLs so that bumping the
// generation on purge changes every URL, forcing browsers/PWAs to drop their
// own HTTP-cached copies. Set isomorphically: server components via the (app)
// layout, the client bundle via <ImageCacheGenerationInit>. 0 = not yet known.
let imageCacheGeneration = 0;

export function setImageCacheGeneration(value: number): void {
  if (Number.isFinite(value) && value > 0) {
    imageCacheGeneration = value;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function toCachedImageSrc(
  src: string | null | undefined,
  serviceHint?: ImageServiceHint,
  opts?: { width?: number }
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
    if (opts?.width) {
      params.set('w', String(opts.width));
    }
    if (imageCacheGeneration > 0) {
      params.set('v', String(imageCacheGeneration));
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
