const LIDARR_ARTIST_MEDIA_COVER_RE =
  /^\/MediaCover\/(\d+)\/([^/]+\.(?:gif|jpg|png))$/i;
const LIDARR_ALBUM_MEDIA_COVER_RE =
  /^\/MediaCover\/Albums\/(\d+)\/([^/]+\.(?:gif|jpg|png))$/i;

function pathRelativeToBase(target: URL, base: URL): string | null {
  if (target.protocol !== base.protocol || target.host !== base.host) {
    return null;
  }

  const basePath = base.pathname.replace(/\/+$/, '');
  if (!basePath || basePath === '/') return target.pathname;
  if (target.pathname === basePath) return '/';
  if (target.pathname.startsWith(`${basePath}/`)) {
    return target.pathname.slice(basePath.length) || '/';
  }
  return null;
}

/**
 * Lidarr's resource models expose locally cached artwork as unauthenticated UI
 * paths (`/MediaCover/...`). With Forms authentication enabled, those paths
 * redirect remote clients to `/login` even when an API key is supplied.
 *
 * Lidarr also exposes the same files through authenticated REST endpoints. Map
 * only the two known local storage layouts to those endpoints, keeping the
 * original query string (notably `lastWrite`) for cache invalidation.
 */
export function toAuthenticatedLidarrImageUrl(target: URL, connectionBase: URL): URL {
  const relativePath = pathRelativeToBase(target, connectionBase);
  if (!relativePath) return target;

  const albumMatch = LIDARR_ALBUM_MEDIA_COVER_RE.exec(relativePath);
  const artistMatch = LIDARR_ARTIST_MEDIA_COVER_RE.exec(relativePath);
  const match = albumMatch ?? artistMatch;
  if (!match) return target;

  const basePath = connectionBase.pathname.replace(/\/+$/, '');
  const kind = albumMatch ? 'album' : 'artist';
  const [, id, filename] = match;
  const rewritten = new URL(target.toString());
  rewritten.pathname = `${basePath}/api/v1/mediacover/${kind}/${id}/${filename}`;
  return rewritten;
}
