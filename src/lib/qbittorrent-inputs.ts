import type { QBittorrentClient } from '@/lib/qbittorrent-client';

// Linux PATH_MAX; anything longer is not a real folder.
const MAX_SAVE_PATH_LENGTH = 4096;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS = 50;
// C0, DEL and C1 (U+0085 among them).
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
// What qBittorrent's QString::trimmed() strips: JS whitespace plus U+0085, which
// JS keeps. A path must be checked as qBittorrent will read it, or a trailing
// U+0085 turns "<root>/.." into a segment that only looks harmless here.
const QT_TRIM = /^[\s\u0085]+|[\s\u0085]+$/g;

function normalizeSavePath(value: string): string | null {
  const normalized = value.replace(QT_TRIM, '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return null;
  if (normalized.split('/').some((segment) => segment === '..')) return null;
  return normalized;
}

/**
 * True when `savepath` resolves under one of qBittorrent's configured download
 * roots (default save path + category save paths). A client-supplied path is
 * only forwarded when it does: otherwise a grantable torrent capability would
 * silently imply "may write torrent payloads anywhere qBittorrent can".
 */
export async function isInsideDownloadRoots(client: QBittorrentClient, savepath: string): Promise<boolean> {
  const normalized = normalizeSavePath(savepath);
  if (!normalized) return false;
  const [defaultSavePath, categories] = await Promise.all([
    client.getDefaultSavePath(),
    client.getCategories(),
  ]);
  const roots = [defaultSavePath, ...Object.values(categories).map((category) => category.savePath)]
    .map((root) => (root ? normalizeSavePath(root) : null))
    .filter((root): root is string => Boolean(root));
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

/** A new save path for torrents/setLocation, trimmed; null when it is not a usable path. */
export function parseLocation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const location = value.trim();
  if (!location || location.length > MAX_SAVE_PATH_LENGTH || CONTROL_CHARACTERS.test(location)) return null;
  return location;
}

/**
 * Tag names for torrents/addTags or removeTags, trimmed and deduplicated; null
 * unless there is at least one. qBittorrent joins tags with commas, so a tag
 * may not hold one, and removeTags with no tags removes every tag.
 */
export function parseTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TAGS) return null;
  const tags = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const tag = item.trim();
    if (!tag || tag.length > MAX_TAG_LENGTH || tag.includes(',') || CONTROL_CHARACTERS.test(tag)) return null;
    tags.add(tag);
  }
  return [...tags];
}
