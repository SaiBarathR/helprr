import { stripSensitiveQuery } from '@/lib/jellyfin-playback/media-path';

const URI_ATTR = /URI="([^"]+)"/gi;

function helprrMediaUrl(jellyfinAbsoluteOrRelative: string, jellyfinOrigin: string, currentDir: string): string {
  let resolved: URL;
  try {
    resolved = new URL(jellyfinAbsoluteOrRelative, `${jellyfinOrigin}${currentDir}`);
  } catch {
    return jellyfinAbsoluteOrRelative;
  }

  if (resolved.origin !== jellyfinOrigin) {
    return jellyfinAbsoluteOrRelative;
  }

  const cleaned = stripSensitiveQuery(resolved.searchParams);
  const qs = cleaned.toString();
  const prefix = `/api/jellyfin/media${resolved.pathname}`;
  return qs ? `${prefix}?${qs}` : prefix;
}

function rewriteTagLine(line: string, jellyfinOrigin: string, currentDir: string): string {
  return line.replace(URI_ATTR, (_match, uri: string) => `URI="${helprrMediaUrl(uri, jellyfinOrigin, currentDir)}"`);
}

/**
 * Rewrite an HLS playlist so every media URI goes through Helprr's authenticated
 * proxy, with Jellyfin API keys stripped. Tags that don't carry URIs are left
 * intact so EXT-X-KEY / MAP / STREAM-INF semantics survive.
 */
export function rewriteHlsPlaylist(
  body: string,
  jellyfinOrigin: string,
  currentPath: string,
): string {
  const dir = currentPath.replace(/[^/]+$/, '');
  return body.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      if (URI_ATTR.test(trimmed)) {
        URI_ATTR.lastIndex = 0;
        return rewriteTagLine(line, jellyfinOrigin, dir);
      }
      URI_ATTR.lastIndex = 0;
      return line;
    }
    return helprrMediaUrl(trimmed, jellyfinOrigin, dir);
  }).join('\n');
}
