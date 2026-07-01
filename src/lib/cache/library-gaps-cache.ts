import { getRedisClient } from '@/lib/redis';
import { getCacheGeneration, getCacheImagesEnabled } from '@/lib/cache/state';
import { buildLibraryGapsKey } from '@/lib/cache/keys';
import type { LibraryGapsResponse } from '@/types';

// Library gaps are derived from several upstream calls (Sonarr series, Radarr collections/movies,
// wanted/missing). The data changes slowly, so a short TTL collapses repeated loads into one fetch
// without showing meaningfully stale gaps. Keyed by cache generation so an admin purge invalidates it.
const LIBRARY_GAPS_TTL_SECONDS = 30;

export async function getCachedLibraryGaps(): Promise<LibraryGapsResponse | null> {
  if (!(await getCacheImagesEnabled())) return null;
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    const raw = await redis.get(buildLibraryGapsKey(generation));
    return raw ? (JSON.parse(raw) as LibraryGapsResponse) : null;
  } catch {
    return null; // cache is best-effort — fall through to a live fetch
  }
}

export async function setCachedLibraryGaps(response: LibraryGapsResponse): Promise<void> {
  if (!(await getCacheImagesEnabled())) return;
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    await redis.set(buildLibraryGapsKey(generation), JSON.stringify(response), {
      EX: LIBRARY_GAPS_TTL_SECONDS,
    });
  } catch {
    // noop — caching is best-effort
  }
}

// Gaps derive from the library, so invalidateTaggedLibrary drops this alongside
// the library entry — a deleted/added item shouldn't replay in gaps for the TTL.
export async function deleteCachedLibraryGaps(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    await redis.del(buildLibraryGapsKey(generation));
  } catch {
    // noop — busting is best-effort; the short TTL is the backstop
  }
}
