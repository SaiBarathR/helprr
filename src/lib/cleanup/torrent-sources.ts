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
    /** The names of the torrents left out for being in more than one qBittorrent, one per hash. */
    duplicateNames: string[];
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
  const nameByHash = new Map<string, string>();
  for (const torrent of lists.flat()) {
    const hash = torrent.hash.toLowerCase();
    const seen = instancesByHash.get(hash) ?? new Set<string>();
    seen.add(torrent.qbitInstanceId);
    instancesByHash.set(hash, seen);
    if (!nameByHash.has(hash)) nameByHash.set(hash, torrent.name || hash);
  }
  const duplicated = new Set([...instancesByHash].filter(([, seen]) => seen.size > 1).map(([hash]) => hash));
  return {
    ok: true,
    torrents: lists.flat().filter((torrent) => !duplicated.has(torrent.hash.toLowerCase())),
    listedHashes: [...instancesByHash.keys()],
    duplicateNames: [...duplicated].map((hash) => nameByHash.get(hash) ?? hash),
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

// Enough names to find them in qBittorrent; a warning stays one line or two.
const MAX_NAMED_DUPLICATES = 3;

/** The warning a cycle gives for the torrents left out by listCleanupTorrents, naming them. */
export function duplicateHashWarning(names: string[]): string | null {
  const count = names.length;
  if (count === 0) return null;
  if (count === 1) return `"${names[0]}" is in more than one qBittorrent and was skipped`;
  const shown = names.slice(0, MAX_NAMED_DUPLICATES).map((name) => `"${name}"`).join(', ');
  const more = count > MAX_NAMED_DUPLICATES ? ` and ${count - MAX_NAMED_DUPLICATES} more` : '';
  return `${count} torrents are in more than one qBittorrent and were skipped: ${shown}${more}`;
}
