import { getLidarrClients, getRadarrClients, getSonarrClients } from '@/lib/service-helpers';
import type { DownloadClient } from '@/types/arr';

/** A Sonarr, Radarr or Lidarr download client that names a qBittorrent category. */
export interface ArrCategoryUse {
  app: 'Sonarr' | 'Radarr' | 'Lidarr';
  instance: string;
  downloadClient: string;
  category: string;
}

export interface ArrCategoryUsage {
  uses: ArrCategoryUse[];
  /** Instances that did not answer, so a use there can't be ruled out. */
  unchecked: string[];
}

// tvCategory, movieCategory, musicCategory, their *ImportedCategory (where an
// arr moves a torrent after importing it), and any later field of that kind.
const CATEGORY_FIELD = /category$/i;

/**
 * Which arr download clients use one of `categories` (or, in subcategory mode,
 * one of their subcategories, which qBittorrent removes with them). Every
 * qBittorrent client counts, enabled or not and whichever qBittorrent it points
 * at: a false alarm costs a confirm, a missed one an arr whose imports stop.
 */
export async function findArrCategoryUses(categories: string[], subcategories: boolean): Promise<ArrCategoryUsage> {
  const removed = (value: string) =>
    categories.some((name) => value === name || (subcategories && value.startsWith(`${name}/`)));
  const instances = [
    ...(await getSonarrClients()).map((entry) => ({ app: 'Sonarr' as const, ...entry })),
    ...(await getRadarrClients()).map((entry) => ({ app: 'Radarr' as const, ...entry })),
    ...(await getLidarrClients()).map((entry) => ({ app: 'Lidarr' as const, ...entry })),
  ];
  const results = await Promise.allSettled(instances.map(({ client }) => client.getDownloadClients()));

  const usage: ArrCategoryUsage = { uses: [], unchecked: [] };
  results.forEach((result, index) => {
    const { app, connection } = instances[index];
    if (result.status === 'rejected' || !Array.isArray(result.value)) {
      usage.unchecked.push(connection.label);
      return;
    }
    for (const downloadClient of result.value as DownloadClient[]) {
      if (downloadClient.implementation !== 'QBittorrent') continue;
      for (const field of downloadClient.fields ?? []) {
        if (!CATEGORY_FIELD.test(field.name) || typeof field.value !== 'string' || !removed(field.value)) continue;
        usage.uses.push({ app, instance: connection.label, downloadClient: downloadClient.name, category: field.value });
      }
    }
  });
  return usage;
}
