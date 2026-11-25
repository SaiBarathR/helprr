import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { getQBittorrentClients } from '@/lib/service-helpers';
import { batchFetchTrackerDomains } from './helpers';
import type { CleanupTorrent } from './types';

export type CleanupTorrentSource =
  | {
    ok: true;
    /** Each with its instance; a hash listed by two qBittorrents is left out. */
    torrents: CleanupTorrent[];
    /** Every hash listed (lower-case), the left-out ones too: their strikes are not orphans. */
    listedHashes: string[];
    /** How many hashes were left out for being in more than one qBittorrent. */
    duplicateHashes: number;
    clients: Map<string, QBittorrentClient>;
  }
  | { ok: false; reason: 'unavailable' | 'listing' };

/**
 * Every qBittorrent's torrents for one cleaner cycle. A cleaner removes
 * torrents, so it acts on all of them or on none: an instance that does not
 * list its torrents stops the cycle, as its strikes would otherwise look
 * orphaned. A hash two qBittorrents list (the same release in both) is left
 * out, since which copy a strike or a removal is for can't be told.
 */
export async function listCleanupTorrents(): Promise<CleanupTorrentSource> {
  let instances;
  try {
    instances = await getQBittorrentClients();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (instances.length === 0) return { ok: false, reason: 'unavailable' };

  let lists;
  try {
    lists = await Promise.all(instances.map(async ({ connection, client }) =>
      (await client.getTorrents()).map((torrent) => ({ ...torrent, qbitInstanceId: connection.id }))));
  } catch {
    return { ok: false, reason: 'listing' };
  }

  const instancesByHash = new Map<string, Set<string>>();
  for (const torrent of lists.flat()) {
    const hash = torrent.hash.toLowerCase();
    const seen = instancesByHash.get(hash) ?? new Set<string>();
    seen.add(torrent.qbitInstanceId);
    instancesByHash.set(hash, seen);
  }
  const duplicated = new Set([...instancesByHash].filter(([, seen]) => seen.size > 1).map(([hash]) => hash));
  return {
    ok: true,
    torrents: lists.flat().filter((torrent) => !duplicated.has(torrent.hash.toLowerCase())),
    listedHashes: [...instancesByHash.keys()],
    duplicateHashes: duplicated.size,
    clients: new Map(instances.map(({ connection, client }) => [connection.id, client])),
  };
}

/** batchFetchTrackerDomains, each torrent asked of its own qBittorrent. */
export async function fetchCleanupTrackerDomains(
  clients: Map<string, QBittorrentClient>,
  torrents: CleanupTorrent[],
): Promise<Map<string, string[] | null>> {
  const merged = new Map<string, string[] | null>();
  await Promise.all([...clients].map(async ([instanceId, client]) => {
    const own = torrents.filter((torrent) => torrent.qbitInstanceId === instanceId);
    if (own.length === 0) return;
    for (const [hash, domains] of await batchFetchTrackerDomains(client, own)) merged.set(hash, domains);
  }));
  return merged;
}

/** The warning a cycle gives for the torrents left out by listCleanupTorrents. */
export function duplicateHashWarning(count: number): string | null {
  return count > 0
    ? `${count} torrent${count === 1 ? ' is' : 's are'} in more than one qBittorrent and ${count === 1 ? 'was' : 'were'} skipped`
    : null;
}
