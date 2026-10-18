/**
 * Allowlist for the Jellyfin media proxy. Only playback, subtitle, attachment,
 * and trickplay paths may be forwarded — never arbitrary Jellyfin admin APIs.
 *
 * Live TV is covered by `/videos/{id}/` too: jellyfin-web plays a channel via
 * the channel item's own stream URL with a `LiveStreamId` query param, not a
 * separate `/LiveTv/` media path (playbackmanager.js builds `directOptions.
 * LiveStreamId` onto the normal video URL). Keeping Live TV on `/videos/` means
 * it goes through the same per-item access check as everything else.
 */

const ITEM_ID = String.raw`[a-fA-F0-9-]{8,}`;

const ALLOWED_PATHS: readonly RegExp[] = [
  new RegExp(String.raw`^/videos/${ITEM_ID}/`, 'i'),
  new RegExp(String.raw`^/audio/${ITEM_ID}/`, 'i'),
  new RegExp(String.raw`^/fallbackfont/fonts(?:/|$)`, 'i'),
];

// Matched case-insensitively: Jellyfin 12 accepts `ApiKey`; older servers may
// also return legacy `api_key` tokens. The proxy supplies its own credential
// in headers, so no caller-supplied token
// should ever reach upstream.
const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'accesstoken',
  'x-emby-token',
  'x-mediabrowser-token',
]);

export function normalizeMediaPath(raw: string): string | null {
  if (!raw) return null;
  let path = raw.trim();
  try {
    if (/^https?:\/\//i.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    return null;
  }
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\\/g, '/');
  // The path is parsed again when the upstream URL is built, and that parser
  // reads `%2e%2e` as `..` and drops tabs and newlines. Neither may reach it.
  if (path.includes('..') || path.includes('//') || /[%\p{Cc}]/u.test(path)) return null;
  return path;
}

const LEGACY_HLS_PREFIX = new RegExp(String.raw`^/(?:videos|audio)/${ITEM_ID}/hls/`, 'i');
const LEGACY_HLS = new RegExp(String.raw`^/(?:videos|audio)/${ITEM_ID}/hls/([a-zA-Z0-9]+)/([^/]+)$`, 'i');

// Jellyfin builds a trickplay playlist for whatever MediaSourceId it is given,
// without checking that item; Helprr reads tiles directly and never needs it.
const TRICKPLAY_PLAYLIST = new RegExp(String.raw`^/videos/${ITEM_ID}/trickplay/\d+/tiles\.m3u8$`, 'i');

export function isAllowedMediaPath(path: string): boolean {
  const normalized = normalizeMediaPath(path);
  if (!normalized) return false;
  // Only the one legacy HLS shape the proxy can check (see legacyHlsTarget).
  if (LEGACY_HLS_PREFIX.test(normalized) && !LEGACY_HLS.test(normalized)) return false;
  if (TRICKPLAY_PLAYLIST.test(normalized)) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(normalized));
}

/**
 * A request on Jellyfin's legacy HLS routes (`…/hls/{playlistId}/{file}`), which
 * live channels play through. Jellyfin picks the playlist by its id and each
 * segment by file name alone, ignoring the item in the path, so the media proxy
 * checks both against what it served this user (see `legacyHlsPlaylistIds`).
 */
export function legacyHlsTarget(path: string): { playlistId: string; file: string } | null {
  const normalized = normalizeMediaPath(path);
  const match = normalized?.match(LEGACY_HLS);
  return match ? { playlistId: match[1], file: match[2] } : null;
}

/**
 * Whether `file` is one of the playlist's own: its playlist, or a segment named
 * after it (`{playlistId}{n}.ts`, or the fMP4 init file `{playlistId}-1.mp4`).
 */
export function isLegacyHlsFileOf(playlistId: string, file: string): boolean {
  const lowerFile = file.toLowerCase();
  const prefix = playlistId.toLowerCase();
  return lowerFile === 'stream.m3u8'
    || (lowerFile.startsWith(prefix) && /^(?:\d+|-1)\.[a-z0-9]+$/.test(lowerFile.slice(prefix.length)));
}

/** Legacy playlist ids a (rewritten) playlist points at, for binding to its item. */
export function legacyHlsPlaylistIds(playlist: string): string[] {
  const ids = new Set<string>();
  for (const match of playlist.matchAll(/\/(?:videos|audio)\/[a-fA-F0-9-]{8,}\/hls\/([a-zA-Z0-9]+)\//gi)) ids.add(match[1]);
  return [...ids];
}

export function itemIdFromMediaPath(path: string): string | null {
  const normalized = normalizeMediaPath(path);
  if (!normalized) return null;
  const match = normalized.match(/^\/(?:videos|audio)\/([a-fA-F0-9-]+)\//i);
  return match?.[1] ?? null;
}

export function stripSensitiveQuery(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...next.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      next.delete(key);
    }
  }
  return next;
}

export function isHlsPlaylist(path: string, contentType: string | null): boolean {
  const normalized = normalizeMediaPath(path) ?? path;
  if (/\.m3u8$/i.test(normalized)) return true;
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return type.includes('mpegurl') || type.includes('x-mpegurl');
}
