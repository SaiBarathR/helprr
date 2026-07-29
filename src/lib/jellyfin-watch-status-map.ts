import type { User } from '@prisma/client';
import {
  getJellyfinUserContext,
  isJellyfinUnavailable,
} from '@/lib/service-helpers';
import { loadCachedArrLibrary } from '@/lib/cache/arr-library';
import { loadAnilistIdsBySeries } from '@/lib/anilist-series-mapping';
import { buildWatchStatusMap } from '@/lib/jellyfin-watch-status';
import { getWatchStatusJson, watchStatusMapSeed } from '@/lib/cache/jellyfin-watch-status-cache';
import type { WatchStatus } from '@/types/watch-status';

export type WatchStatusMapPayload = { items: WatchStatus[]; keys: Record<string, number> };

/**
 * Load the per-user Jellyfin watch-status map (Redis SWR cached). Returns null
 * when Jellyfin is not configured/linked for this user — callers treat that as
 * "no watch overlay available".
 */
export async function fetchUserWatchStatusMap(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<WatchStatusMapPayload | null> {
  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(user);
    const seed = watchStatusMapSeed(connectionFingerprint, jellyfinUserId);

    return getWatchStatusJson(seed, async () => {
      const [library, anilistBySeries, movies, series] = await Promise.all([
        loadCachedArrLibrary(),
        loadAnilistIdsBySeries().catch(() => new Map<string, number[]>()),
        client.queryItems({
          IncludeItemTypes: 'Movie',
          Recursive: true,
          Fields: 'ProviderIds',
          EnableUserData: true,
          EnableImages: false,
        }),
        client.queryItems({
          IncludeItemTypes: 'Series',
          Recursive: true,
          Fields: 'ProviderIds,RecursiveItemCount',
          EnableUserData: true,
          EnableImages: false,
        }),
      ]);
      return buildWatchStatusMap(library, movies.Items ?? [], series.Items ?? [], anilistBySeries);
    });
  } catch (error) {
    if (isJellyfinUnavailable(error)) return null;
    throw error;
  }
}

/** Resolve a watch-status entry from the de-duplicated map payload. */
export function lookupWatchStatus(
  payload: WatchStatusMapPayload,
  key: string
): WatchStatus | undefined {
  const idx = payload.keys[key];
  if (idx === undefined) return undefined;
  return payload.items[idx];
}
