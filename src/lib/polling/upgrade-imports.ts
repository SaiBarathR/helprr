// Telling an upgrade from a new arrival in Sonarr/Radarr history. When the arr
// replaces a file with a better one it writes the old file's deletion
// ("episodeFileDeleted"/"movieFileDeleted", data.reason "Upgrade") just before
// the import, in the same second or the one before (read from real history,
// 2026-11-24). The deletion row carries the old file's quality and the import
// row the new one's.
import type { HistoryItem } from '@/types';

const UPGRADE_WINDOW_MS = 60_000;

function positiveId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

// `fetched` is everything this poll read, not only the new rows: the deletion
// is older than its import, so the previous poll may have read it already (it
// is still on the page this poll fetched, which always reaches back past the
// cursor). The nearest deletion wins when a title was upgraded twice in a minute.
function findUpgradeDeletion(fetched: HistoryItem[], deletedType: string, sameTarget: (h: HistoryItem) => boolean, importDate: string): HistoryItem | undefined {
  const at = Date.parse(importDate);
  let nearest: HistoryItem | undefined;
  for (const h of fetched) {
    if (h.eventType !== deletedType || h.data?.reason !== 'Upgrade' || !sameTarget(h)) continue;
    const gap = Math.abs(Date.parse(h.date) - at);
    if (gap > UPGRADE_WINDOW_MS) continue;
    if (!nearest || gap < Math.abs(Date.parse(nearest.date) - at)) nearest = h;
  }
  return nearest;
}

/** The deletion that makes this Sonarr import an upgrade of the same episode, if any. */
export function sonarrUpgradeOf(item: HistoryItem, fetched: HistoryItem[]): HistoryItem | undefined {
  const episodeId = positiveId(item.episodeId ?? item.episode?.id);
  if (!episodeId) return undefined;
  return findUpgradeDeletion(fetched, 'episodeFileDeleted', (h) => h.episodeId === episodeId, item.date);
}

/** The deletion that makes this Radarr import an upgrade of the same movie, if any. */
export function radarrUpgradeOf(item: HistoryItem, fetched: HistoryItem[]): HistoryItem | undefined {
  const movieId = positiveId(item.movieId);
  if (!movieId) return undefined;
  return findUpgradeDeletion(fetched, 'movieFileDeleted', (h) => h.movieId === movieId, item.date);
}

/**
 * "WEBDL-1080p → Bluray-2160p: <release>". An upgrade within one quality (a
 * proper, a repack or a better custom-format score) reads "Better WEBDL-2160p: <release>".
 */
export function upgradeBody(imported: HistoryItem, deleted: HistoryItem): string {
  const from = deleted.quality?.quality?.name;
  const to = imported.quality?.quality?.name;
  if (!from || !to) return imported.sourceTitle;
  if (from === to) return `Better ${to}: ${imported.sourceTitle}`;
  return `${from} → ${to}: ${imported.sourceTitle}`;
}
