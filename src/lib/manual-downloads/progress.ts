import { getQBittorrentClient } from '@/lib/service-helpers';
import type { SerializedManualDownload } from './serialize';

export interface DownloadProgress {
  fraction: number;
  size: number | null;
}

/** One filtered torrent read per existing list/detail refresh; history needs no upstream read. */
export async function withDownloadProgress(downloads: SerializedManualDownload[]) {
  const active = downloads.filter((download) => ['QUEUED', 'DOWNLOADING'].includes(download.status));
  const progress = new Map<string, DownloadProgress>();
  if (active.length > 0) {
    try {
      const hashes = [...new Set(active.map((download) => download.infoHash.toLowerCase()))].join('|');
      const torrents = await (await getQBittorrentClient()).getTorrents(undefined, undefined, undefined, undefined, hashes);
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
