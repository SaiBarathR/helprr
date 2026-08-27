/**
 * Allowlist for the Jellyfin media proxy. Only playback, subtitle, attachment,
 * trickplay, and live-stream paths may be forwarded — never arbitrary Jellyfin
 * admin APIs.
 */

const ITEM_ID = String.raw`[a-fA-F0-9-]{8,}`;

const ALLOWED_PATHS: readonly RegExp[] = [
  new RegExp(String.raw`^/videos/${ITEM_ID}/`, 'i'),
  new RegExp(String.raw`^/audio/${ITEM_ID}/`, 'i'),
  new RegExp(String.raw`^/livetv/livestream(?:\.m3u8)?$`, 'i'),
  new RegExp(String.raw`^/fallbackfont/fonts`, 'i'),
];

const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'apiKey',
  'ApiKey',
  'access_token',
  'AccessToken',
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
    if (SENSITIVE_QUERY_KEYS.has(key) || key.toLowerCase() === 'api_key') {
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
