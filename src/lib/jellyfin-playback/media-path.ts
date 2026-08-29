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
  new RegExp(String.raw`^/fallbackfont/fonts`, 'i'),
];

// Matched case-insensitively: Jellyfin accepts `api_key` and `ApiKey`, and the
// proxy supplies its own credential in headers, so no caller-supplied token
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
  if (path.includes('..') || path.includes('//')) return null;
  return path;
}

export function isAllowedMediaPath(path: string): boolean {
  const normalized = normalizeMediaPath(path);
  if (!normalized) return false;
  return ALLOWED_PATHS.some((pattern) => pattern.test(normalized));
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
