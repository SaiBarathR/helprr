import { prisma } from '@/lib/db';
import { getQBittorrentClient } from '@/lib/service-helpers';
import type { SerializedManualDownload } from './serialize';

const PROGRESS_TIMEOUT_MS = 2_000;

export interface DownloadProgress {
  fraction: number;
  size: number | null;
}

/**
 * Bytes of the files chosen for each "choose files" download. qBittorrent refreshes a torrent's
 * selected size a moment after its file priorities change, so the read right after Start still
 * reports the whole torrent; Helprr's record of the choice is right from the first read. The detail
 * route has already loaded the files; only the list needs the database.
 */
async function chosenSizes(downloads: SerializedManualDownload[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  const missing: string[] = [];
  for (const download of downloads) {
    if (download.mode !== 'QBIT_REVIEWED') continue;
    if (download.files) sizes.set(download.id, download.files.reduce((sum, file) => sum + (file.selected ? file.size : 0), 0));
    else missing.push(download.id);
  }
  if (missing.length > 0) {
    const sums = await prisma.manualDownloadFile.groupBy({ by: ['downloadId'], where: { downloadId: { in: missing }, selected: true }, _sum: { size: true } });
    for (const sum of sums) sizes.set(sum.downloadId, Number(sum._sum.size ?? 0));
  }
  return sizes;
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const torrents = await Promise.race([
        getQBittorrentClient().then((client) => client.getTorrents(undefined, undefined, undefined, undefined, hashes)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('progress timeout')), PROGRESS_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
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
  // Only downloads qBittorrent answered for need a size; a failed lookup is as harmless as a failed read.
  const read = active.filter((download) => progress.has(download.infoHash.toUpperCase()));
  const chosen = await chosenSizes(read).catch(() => new Map<string, number>());
  return downloads.map((download) => {
    const reading = active.includes(download) ? progress.get(download.infoHash.toUpperCase()) : undefined;
    if (!reading) return { ...download, progress: null };
    const picked = chosen.get(download.id);
    // The smaller figure is the selection qBittorrent is working on: right after Start it still reports the
    // whole torrent, and when files are unticked later (in Helprr or in qBittorrent) its own size is newer.
    const size = picked && reading.size ? Math.min(picked, reading.size) : picked || reading.size;
    return { ...download, progress: { ...reading, size } };
  });
}
