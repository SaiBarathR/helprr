import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import {
  getCachedTaggedLibrary,
  emptyTaggedLibrary,
  type Tagged,
  type TaggedLibraryResult,
} from '@/lib/cache/tagged-library';
import type { RadarrMovie, SonarrSeries, LidarrArtist } from '@/types';
import type { InsightsStorageItem, InsightsStorageResponse } from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

const TOP_N = 8;

interface ServiceRollup {
  total: number | null;
  count: number | null;
  items: InsightsStorageItem[];
  unmonitored: number;
}

// Roll a tagged library up into a per-service total/count/items + unmonitored bytes.
// total/count stay null when the service is unavailable (unpermitted, unconfigured,
// or every instance failed) so the card hides the row instead of showing a stray 0.
function summarize<T extends { monitored?: boolean }>(
  lib: TaggedLibraryResult<T>,
  size: (row: Tagged<T>) => number,
  toItem: (row: Tagged<T>, size: number) => InsightsStorageItem,
): ServiceRollup {
  if (!lib.available) return { total: null, count: null, items: [], unmonitored: 0 };
  let total = 0;
  let unmonitored = 0;
  const items: InsightsStorageItem[] = [];
  for (const row of lib.items) {
    const bytes = size(row);
    if (bytes <= 0) continue;
    total += bytes;
    if (!row.monitored) unmonitored += bytes;
    items.push(toItem(row, bytes));
  }
  return { total, count: lib.items.length, items, unmonitored };
}

async function getHandler() {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Reuse the same 120s library cache the /api/sonarr & /api/radarr routes populate
  // (full objects carry sizeOnDisk), so opening Insights doesn't re-pull every library.
  const [movieLib, seriesLib, musicLib] = await Promise.all([
    can(user, 'movies.view')
      ? getCachedTaggedLibrary({
          scope: 'radarr',
          cacheKeySeed: 'all',
          getInstances: () => getRadarrClients().catch(() => []),
          fetchOne: (client) => client.getMovies(),
        })
      : Promise.resolve(emptyTaggedLibrary<RadarrMovie>()),
    can(user, 'series.view')
      ? getCachedTaggedLibrary({
          scope: 'sonarr',
          cacheKeySeed: 'all',
          getInstances: () => getSonarrClients().catch(() => []),
          fetchOne: (client) => client.getSeries(),
        })
      : Promise.resolve(emptyTaggedLibrary<SonarrSeries>()),
    can(user, 'music.view')
      ? getCachedTaggedLibrary({
          scope: 'lidarr',
          cacheKeySeed: 'all',
          getInstances: () => getLidarrClients().catch(() => []),
          fetchOne: (client) => client.getArtists(),
        })
      : Promise.resolve(emptyTaggedLibrary<LidarrArtist>()),
  ]);

  const movies = summarize(
    movieLib,
    (m) => m.sizeOnDisk ?? 0,
    (m, size) => ({ title: m.title, year: m.year, sizeOnDisk: size, kind: 'movie', href: `/movies/${m.id}?instance=${m.instanceId}` }),
  );
  const series = summarize(
    seriesLib,
    (s) => s.statistics?.sizeOnDisk ?? 0,
    (s, size) => ({ title: s.title, year: s.year, sizeOnDisk: size, kind: 'series', href: `/series/${s.id}?instance=${s.instanceId}` }),
  );
  const music = summarize(
    musicLib,
    (a) => a.statistics?.sizeOnDisk ?? 0,
    (a, size) => ({ title: a.artistName, sizeOnDisk: size, kind: 'artist', href: `/music/${a.id}?instance=${a.instanceId}` }),
  );

  const topItems = [...movies.items, ...series.items, ...music.items]
    .sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)
    .slice(0, TOP_N);

  const response: InsightsStorageResponse = {
    totals: { movies: movies.total, series: series.total, music: music.total },
    counts: { movies: movies.count, series: series.count, music: music.count },
    topItems,
    unmonitoredBytes: movies.unmonitored + series.unmonitored + music.unmonitored,
  };
  return NextResponse.json(response);
}

export const GET = withApiLogging(getHandler, 'api/insights/storage');
