import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import {
  getJellyfinUserContext,
  getRadarrClients,
  getSonarrClients,
  isJellyfinUnavailable,
} from '@/lib/service-helpers';
import { getCachedTaggedLibrary, type Tagged } from '@/lib/cache/tagged-library';
import type { RadarrMovie, SonarrSeries } from '@/types';
import { loadAnilistIdsBySeries } from '@/lib/anilist-series-mapping';
import { buildWatchStatusMap } from '@/lib/jellyfin-watch-status';
import {
  getWatchStatusJson,
  invalidateWatchStatus,
  seriesEpisodesSeed,
  watchStatusMapSeed,
} from '@/lib/cache/jellyfin-watch-status-cache';
import type { WatchStatusMapResponse } from '@/types/watch-status';

const EMPTY: WatchStatusMapResponse = { linked: false, items: [], keys: {} };

// Reuse the same cached arr-library entries the /api/radarr and /api/sonarr list
// routes populate (scope + seed 'all'), so a warm library serves the watch map
// instead of an uncached full re-fetch on every map (re)build.
async function loadCachedArrLibrary(): Promise<{ movies: Tagged<RadarrMovie>[]; series: Tagged<SonarrSeries>[] }> {
  const [movies, series] = await Promise.all([
    getCachedTaggedLibrary({ scope: 'radarr', cacheKeySeed: 'all', getInstances: getRadarrClients, fetchOne: (c) => c.getMovies() }),
    getCachedTaggedLibrary({ scope: 'sonarr', cacheKeySeed: 'all', getInstances: getSonarrClients, fetchOne: (c) => c.getSeries() }),
  ]);
  return { movies: movies.items, series: series.items };
}

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    const seed = watchStatusMapSeed(connectionFingerprint, jellyfinUserId);

    const payload = await getWatchStatusJson(seed, async () => {
      // All four reads are independent — overlap them so a cold-cache revalidation
      // costs max(arr+anilist, two Jellyfin scans), not their sum. (best-effort on
      // anilist: a mapping-table hiccup only drops the anime-browse aliases.)
      const [library, anilistBySeries, movies, series] = await Promise.all([
        loadCachedArrLibrary(),
        loadAnilistIdsBySeries().catch(() => new Map<string, number[]>()),
        client.queryItems({ IncludeItemTypes: 'Movie', Recursive: true, Fields: 'ProviderIds', EnableUserData: true, EnableImages: false }),
        client.queryItems({ IncludeItemTypes: 'Series', Recursive: true, Fields: 'ProviderIds,RecursiveItemCount', EnableUserData: true, EnableImages: false }),
      ]);
      return buildWatchStatusMap(library, movies.Items ?? [], series.Items ?? [], anilistBySeries);
    });

    return NextResponse.json({ linked: true, ...payload } satisfies WatchStatusMapResponse);
  } catch (error) {
    if (isJellyfinUnavailable(error)) return NextResponse.json(EMPTY);
    // Never 500 a navigation: on a hard failure with no cache, just render no
    // indicators rather than breaking the page the overlay sits on.
    console.error('Jellyfin watch-status map failed:', error);
    return NextResponse.json(EMPTY);
  }
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.watchedState');
  if (!auth.ok) return auth.response;

  let body: { jellyfinItemId?: unknown; played?: unknown; seriesId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jellyfinItemId, played, seriesId } = body;
  if (typeof jellyfinItemId !== 'string' || !jellyfinItemId || typeof played !== 'boolean') {
    return NextResponse.json({ error: 'jellyfinItemId and played are required' }, { status: 400 });
  }

  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    if (played) await client.markPlayed(jellyfinItemId);
    else await client.markUnplayed(jellyfinItemId);

    // Always invalidate the library map (a series/episode toggle flips the
    // aggregate). For a series/episode write, also drop that series' episode map
    // — marking a series cascades to its episodes server-side.
    await invalidateWatchStatus(watchStatusMapSeed(connectionFingerprint, jellyfinUserId));
    if (typeof seriesId === 'string' && seriesId) {
      await invalidateWatchStatus(seriesEpisodesSeed(connectionFingerprint, jellyfinUserId, seriesId));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isJellyfinUnavailable(error)) {
      return NextResponse.json({ error: 'Jellyfin account not linked' }, { status: 409 });
    }
    console.error('Jellyfin watch-status write failed:', error);
    return NextResponse.json({ error: 'Failed to update watch status' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/watch-status');
export const POST = withApiLogging(postHandler, 'api/jellyfin/watch-status');
