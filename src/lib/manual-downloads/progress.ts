import { getQBittorrentClient } from '@/lib/service-helpers';
import type { SerializedManualDownload } from './serialize';

const PROGRESS_TIMEOUT_MS = 2_000;

export interface DownloadProgress {
  fraction: number;
  size: number | null;
}

/**
 * One filtered torrent read per existing list/detail refresh; history needs no upstream read.
 * Best effort from Helprr's own qBittorrent: an Arr using another client simply shows no figure.
 */
export async function withDownloadProgress(downloads: SerializedManualDownload[]) {
  const active = downloads.filter((download) => ['QUEUED', 'DOWNLOADING'].includes(download.status));
  const progress = new Map<string, DownloadProgress>();
  if (active.length > 0) {
    try {
      const hashes = [...new Set(active.map((download) => download.infoHash.toLowerCase()))].join('|');
      // Progress is a nicety: a slow qBittorrent must not hold up the workflow list.
      const torrents = await Promise.race([
        getQBittorrentClient().then((client) => client.getTorrents(undefined, undefined, undefined, undefined, hashes)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('progress timeout')), PROGRESS_TIMEOUT_MS)),
      ]);
      for (const torrent of torrents) {
        if (!Number.isFinite(torrent.progress)) continue;
        progress.set(torrent.hash.toUpperCase(), {
          fraction: Math.max(0, Math.min(1, torrent.progress)),
          size: Number.isFinite(torrent.size) && torrent.size > 0 ? torrent.size : null,
        });
      }
    } catch {
      // Arr may use a different client, or qBittorrent may be unavailable; keep the workflow visible.
    }
  }
  return downloads.map((download) => ({ ...download, progress: active.includes(download) ? progress.get(download.infoHash.toUpperCase()) ?? null : null }));
}
