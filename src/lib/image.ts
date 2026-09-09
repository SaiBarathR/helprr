export type ImageServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'anilist' | 'lidarr';

export const RESPONSIVE_IMAGE_WIDTH_BUCKETS = [160, 240, 320, 480, 640] as const;

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

export function selectResponsiveImageWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return RESPONSIVE_IMAGE_WIDTH_BUCKETS[0];
  return RESPONSIVE_IMAGE_WIDTH_BUCKETS.find((bucket) => bucket >= width)
    ?? RESPONSIVE_IMAGE_WIDTH_BUCKETS[RESPONSIVE_IMAGE_WIDTH_BUCKETS.length - 1];
}

export function setProtectedImageWidth(src: string, width: number): string {
  const selectedWidth = selectResponsiveImageWidth(width);
  try {
    const parsed = new URL(src, 'http://localhost');
    if (parsed.pathname === '/api/image') {
      parsed.searchParams.set('w', String(selectedWidth));
    } else if (parsed.pathname === '/api/jellyfin/image') {
      parsed.searchParams.set('maxWidth', String(selectedWidth));
    } else {
      return src;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return src;
  }
}

export function toProtectedImageSrcSet(src: string): string | undefined {
  if (!isProtectedApiImageSrc(src)) return undefined;
  return RESPONSIVE_IMAGE_WIDTH_BUCKETS
    .map((width) => `${setProtectedImageWidth(src, width)} ${width}w`)
    .join(', ');
}

export function isProtectedApiImageSrc(src: string): boolean {
  try {
    const parsed = new URL(src, 'http://localhost');
    return parsed.pathname === '/api/jellyfin/image' || parsed.pathname === '/api/image';
  } catch {
    return false;
  }
}
