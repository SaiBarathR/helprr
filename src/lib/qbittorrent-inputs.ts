import type { AddTorrentOptions, ContentLayout, QBittorrentClient } from '@/lib/qbittorrent-client';

// Linux PATH_MAX; anything longer is not a real folder.
const MAX_SAVE_PATH_LENGTH = 4096;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS = 50;
// A file name's limit on most filesystems; qBittorrent shows the name, it is no path.
const MAX_RENAME_LENGTH = 255;
// qBittorrent reads torrents/add's upLimit and dlLimit as a signed 32-bit int.
const MAX_SPEED_LIMIT = 2_147_483_647;
const CONTENT_LAYOUTS: readonly ContentLayout[] = ['Original', 'Subfolder', 'NoSubfolder'];
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

const ADD_BOOLEANS = ['sequentialDownload', 'firstLastPiecePrio', 'autoTMM', 'skipChecking', 'addToTopOfQueue'] as const;
const ADD_LIMITS = ['dlLimit', 'upLimit'] as const;

/**
 * The torrents/add options from a magnet's JSON body or a file's form fields
 * (`read` gives a field, undefined or null when absent; a form sends booleans
 * as "true"/"false" and numbers as digits). Only these fields are forwarded,
 * and a value qBittorrent would quietly ignore is refused instead, so the
 * torrent never lands with a setting other than the one asked for.
 */
export function parseAddTorrentOptions(
  read: (field: string) => unknown,
): { ok: true; options: AddTorrentOptions } | { ok: false; error: string } {
  const options: AddTorrentOptions = {};

  for (const field of ADD_BOOLEANS) {
    const value = read(field);
    if (value === undefined || value === null) continue;
    if (value === true || value === 'true') options[field] = true;
    else if (value === false || value === 'false') options[field] = false;
    else return { ok: false, error: `${field} must be true or false` };
  }

  for (const field of ADD_LIMITS) {
    const value = read(field);
    if (value === undefined || value === null) continue;
    const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > MAX_SPEED_LIMIT) {
      return { ok: false, error: 'Speed limits are whole bytes per second, from 0 (unlimited) to 2147483647' };
    }
    // 0 is qBittorrent's "no limit", which is also what leaving it out gives.
    if (limit > 0) options[field] = limit;
  }

  const layout = read('contentLayout');
  if (layout !== undefined && layout !== null) {
    if (!CONTENT_LAYOUTS.includes(layout as ContentLayout)) {
      return { ok: false, error: 'contentLayout must be Original, Subfolder or NoSubfolder' };
    }
    options.contentLayout = layout as ContentLayout;
  }

  const rename = read('rename');
  if (rename !== undefined && rename !== null) {
    const name = typeof rename === 'string' ? rename.replace(QT_TRIM, '') : null;
    if (name === null || name.length > MAX_RENAME_LENGTH || /[/\\]/.test(name) || CONTROL_CHARACTERS.test(name)) {
      return { ok: false, error: 'The name needs at most 255 characters and no slash' };
    }
    if (name) options.rename = name;
  }

  const rawTags = read('tags');
  if (rawTags !== undefined && rawTags !== null && !(Array.isArray(rawTags) && rawTags.length === 0)) {
    const tags = parseTags(rawTags);
    if (!tags) return { ok: false, error: 'Each tag needs 1 to 100 characters and no comma' };
    options.tags = tags;
  }

  return { ok: true, options };
}
