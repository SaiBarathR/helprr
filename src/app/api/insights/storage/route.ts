import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { InsightsStorageItem, InsightsStorageResponse } from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

const TOP_N = 8;

async function getHandler() {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const [radarrInstances, sonarrInstances, lidarrInstances] = await Promise.all([
    can(user, 'movies.view') ? getRadarrClients().catch(() => []) : [],
    can(user, 'series.view') ? getSonarrClients().catch(() => []) : [],
    can(user, 'music.view') ? getLidarrClients().catch(() => []) : [],
  ]);

  const items: InsightsStorageItem[] = [];
  let unmonitoredBytes = 0;

  // Per-service totals stay null when the service is unpermitted, unconfigured,
  // or every instance failed — the card hides those rows instead of showing 0.
  let moviesTotal: number | null = null;
  let moviesCount: number | null = null;
  let seriesTotal: number | null = null;
  let seriesCount: number | null = null;
  let musicTotal: number | null = null;
  let musicCount: number | null = null;

  const [movieLists, seriesLists, artistLists] = await Promise.all([
    Promise.all(
      radarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        list: await client.getMovies().catch(() => null),
      }))
    ),
    Promise.all(
      sonarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        list: await client.getSeries().catch(() => null),
      }))
    ),
    Promise.all(
      lidarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        list: await client.getArtists().catch(() => null),
      }))
    ),
  ]);

  for (const { instanceId, list } of movieLists) {
    if (!list) continue;
    moviesTotal = (moviesTotal ?? 0);
    moviesCount = (moviesCount ?? 0) + list.length;
    for (const movie of list) {
      const size = movie.sizeOnDisk ?? 0;
      if (size <= 0) continue;
      moviesTotal += size;
      if (!movie.monitored) unmonitoredBytes += size;
      items.push({
        title: movie.title,
        year: movie.year,
        sizeOnDisk: size,
        kind: 'movie',
        href: `/movies/${movie.id}?instance=${instanceId}`,
      });
    }
  }

  for (const { instanceId, list } of seriesLists) {
    if (!list) continue;
    seriesTotal = (seriesTotal ?? 0);
    seriesCount = (seriesCount ?? 0) + list.length;
    for (const show of list) {
      const size = show.statistics?.sizeOnDisk ?? 0;
      if (size <= 0) continue;
      seriesTotal += size;
      if (!show.monitored) unmonitoredBytes += size;
      items.push({
        title: show.title,
        year: show.year,
        sizeOnDisk: size,
        kind: 'series',
        href: `/series/${show.id}?instance=${instanceId}`,
      });
    }
  }

  for (const { instanceId, list } of artistLists) {
    if (!list) continue;
    musicTotal = (musicTotal ?? 0);
    musicCount = (musicCount ?? 0) + list.length;
    for (const artist of list) {
      const size = artist.statistics?.sizeOnDisk ?? 0;
      if (size <= 0) continue;
      musicTotal += size;
      if (!artist.monitored) unmonitoredBytes += size;
      items.push({
        title: artist.artistName,
        sizeOnDisk: size,
        kind: 'artist',
        href: `/music/${artist.id}?instance=${instanceId}`,
      });
    }
  }

  const topItems = items.sort((a, b) => b.sizeOnDisk - a.sizeOnDisk).slice(0, TOP_N);

  const response: InsightsStorageResponse = {
    totals: { movies: moviesTotal, series: seriesTotal, music: musicTotal },
    counts: { movies: moviesCount, series: seriesCount, music: musicCount },
    topItems,
    unmonitoredBytes,
  };
  return NextResponse.json(response);
}

export const GET = withApiLogging(getHandler, 'api/insights/storage');
