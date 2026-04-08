export type ImageServiceHint = 'tmdb' | 'radarr' | 'sonarr' | 'jellyfin' | 'anilist';

const THIRD_PARTY_IMAGE_HOSTS = new Set<string>([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'thetvdb.com',
  'www.thetvdb.com',
  'fanart.tv',
  'assets.fanart.tv',
  'static.tvmaze.com',
  's4.anilist.co',
  's1.anilist.co',
  's2.anilist.co',
  's3.anilist.co',
]);

/** Transparent 1×1 GIF returned instead of null so `|| originalUrl` fallbacks stay inert. */
const HIDDEN_IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let _hideExternalImages = false;

export function setHideExternalImages(value: boolean) {
  _hideExternalImages = value;
}

function isThirdPartyImageUrl(src: string): boolean {
  try {
    const parsed = new URL(src);
    return THIRD_PARTY_IMAGE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function toCachedImageSrc(
  src: string | null | undefined,
  serviceHint?: ImageServiceHint
): string | null {
  if (!src) return null;

  if (_hideExternalImages && isHttpUrl(src) && isThirdPartyImageUrl(src)) {
    return HIDDEN_IMAGE_PLACEHOLDER;
  }

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
