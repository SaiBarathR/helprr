// "It's here" alerts: when Radarr/Sonarr imports a title someone has on their
// watchlist, that person (and only they) gets their own copy. Matching uses the
// title's TMDB/TVDB id, so it is the same whichever instance imported it. Each
// watchlist item is alerted once (WatchlistItem.availableNotifiedAt), so a
// second instance, a later episode or a retried poll never pushes again, even
// after the person clears their notifications.
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import type { Prisma } from '@prisma/client';
import type { HistoryItem } from '@/types';
import { notifyAndLog } from './shared';

export interface LibraryArrival {
  kind: 'movie' | 'series';
  instanceId: string;
  /** The Radarr movie id or Sonarr series id on that instance. */
  arrId: number;
  /** Only one instance of this app is connected, so its ids are unambiguous. */
  soleInstance: boolean;
  title: string;
  tmdbId?: number;
  tvdbId?: number;
  /** Sonarr only: the episodes imported this cycle, as "S01E02". */
  episodes?: string[];
}

const MOVIE_IMPORTS = new Set(['downloadFolderImported', 'movieFileImported']);
const EPISODE_IMPORTS = new Set(['downloadFolderImported', 'episodeFileImported']);
const UPGRADE_WINDOW_MS = 60_000;

// An upgrade deletes the old file ("…FileDeleted", data.reason "Upgrade") in the
// same second as the import, so nothing new arrived. `fetched` is everything
// this poll read, so a deletion seen by the previous poll still counts.
function isUpgrade(fetched: HistoryItem[], deletedType: string, sameTarget: (h: HistoryItem) => boolean, importDate: string): boolean {
  const at = Date.parse(importDate);
  return fetched.some((h) => h.eventType === deletedType && h.data?.reason === 'Upgrade' && sameTarget(h)
    && Math.abs(Date.parse(h.date) - at) <= UPGRADE_WINDOW_MS);
}

function positiveId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function movieArrivals(newHistory: HistoryItem[], fetched: HistoryItem[], instanceId: string, soleInstance: boolean): LibraryArrival[] {
  const byMovie = new Map<number, LibraryArrival>();
  for (const item of newHistory) {
    const movieId = positiveId(item.movieId);
    if (!MOVIE_IMPORTS.has(item.eventType) || !movieId || !item.movie?.title || byMovie.has(movieId)) continue;
    if (isUpgrade(fetched, 'movieFileDeleted', (h) => h.movieId === movieId, item.date)) continue;
    byMovie.set(movieId, {
      kind: 'movie',
      instanceId,
      arrId: movieId,
      soleInstance,
      title: item.movie.title,
      tmdbId: positiveId(item.movie.tmdbId),
    });
  }
  return [...byMovie.values()];
}

function episodeLabel(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

export function seriesArrivals(newHistory: HistoryItem[], fetched: HistoryItem[], instanceId: string, soleInstance: boolean): LibraryArrival[] {
  const bySeries = new Map<number, LibraryArrival>();
  for (const item of newHistory) {
    const seriesId = positiveId(item.seriesId);
    const episodeId = positiveId(item.episodeId ?? item.episode?.id);
    if (!EPISODE_IMPORTS.has(item.eventType) || !seriesId || !episodeId || !item.series?.title) continue;
    if (isUpgrade(fetched, 'episodeFileDeleted', (h) => h.episodeId === episodeId, item.date)) continue;
    let arrival = bySeries.get(seriesId);
    if (!arrival) {
      arrival = {
        kind: 'series',
        instanceId,
        arrId: seriesId,
        soleInstance,
        title: item.series.title,
        tvdbId: positiveId(item.series.tvdbId),
        tmdbId: positiveId(item.series.tmdbId),
        episodes: [],
      };
      bySeries.set(seriesId, arrival);
    }
    const ep = item.episode;
    if (ep && Number.isInteger(ep.seasonNumber) && Number.isInteger(ep.episodeNumber)) {
      const label = episodeLabel(ep.seasonNumber, ep.episodeNumber);
      if (!arrival.episodes!.includes(label)) arrival.episodes!.push(label);
    }
  }
  return [...bySeries.values()];
}

/** The same title from any instance gets the same key. */
function titleKey(arrival: LibraryArrival): string {
  if (arrival.kind === 'movie') {
    return arrival.tmdbId ? `movie-tmdb-${arrival.tmdbId}` : `movie-radarr-${arrival.instanceId}-${arrival.arrId}`;
  }
  if (arrival.tvdbId) return `series-tvdb-${arrival.tvdbId}`;
  if (arrival.tmdbId) return `series-tmdb-${arrival.tmdbId}`;
  return `series-sonarr-${arrival.instanceId}-${arrival.arrId}`;
}

function whereFor(arrival: LibraryArrival): Prisma.WatchlistItemWhereInput[] {
  const arrSource = arrival.kind === 'movie' ? 'RADARR' : 'SONARR';
  const mediaType = arrival.kind === 'movie' ? 'movie' : 'series';
  const where: Prisma.WatchlistItemWhereInput[] = [
    { source: arrSource, mediaType, externalId: String(arrival.arrId) },
  ];
  if (arrival.tmdbId) where.push({ source: 'TMDB', mediaType, externalId: String(arrival.tmdbId) });
  if (arrival.tvdbId) where.push({ source: 'TVDB', mediaType, externalId: String(arrival.tvdbId) });
  return where;
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matches(
  item: { source: string; externalId: string; mediaType: string; title: string },
  arrival: LibraryArrival,
): boolean {
  const mediaType = arrival.kind === 'movie' ? 'movie' : 'series';
  if (item.mediaType !== mediaType) return false;
  if (item.source === (arrival.kind === 'movie' ? 'RADARR' : 'SONARR')) {
    // Items saved from a library page store the Radarr/Sonarr id, which is only
    // unique within one instance. With several connected, the title must match
    // too, so movie 12 on another instance never stands in for this one.
    return item.externalId === String(arrival.arrId) && (arrival.soleInstance || sameTitle(item.title, arrival.title));
  }
  if (item.source === 'TMDB') return arrival.tmdbId !== undefined && item.externalId === String(arrival.tmdbId);
  if (item.source === 'TVDB') return arrival.tvdbId !== undefined && item.externalId === String(arrival.tvdbId);
  return false;
}

function bodyFor(arrival: LibraryArrival): string {
  const episodes = arrival.episodes ?? [];
  if (episodes.length === 1) return `From your watchlist: ${episodes[0]} is ready to watch.`;
  if (episodes.length > 1) return `From your watchlist: ${episodes.length} episodes are ready to watch.`;
  return 'From your watchlist: ready to watch.';
}

function reportFailure(error: unknown) {
  noteJobFailure(error);
  logger.warn('Watchlist availability alerts failed', {
    reason: error instanceof Error ? error.message : String(error),
  }, { scope: 'polling' });
}

function findUnnotifiedItems(arrivals: LibraryArrival[]) {
  return prisma.watchlistItem.findMany({
    where: { userId: { not: null }, availableNotifiedAt: null, OR: arrivals.flatMap(whereFor) },
    select: {
      id: true,
      source: true,
      externalId: true,
      mediaType: true,
      title: true,
      user: { select: { id: true, role: true, status: true, template: true, permissions: true } },
    },
    orderBy: { addedAt: 'asc' },
  });
}
type MatchedItem = Awaited<ReturnType<typeof findUnnotifiedItems>>[number];

/**
 * Sends each person whose watchlist holds an arrived title one alert for it.
 * Never throws: a failure here must not stop the poller from saving its
 * history cursor (that would re-send the instance's own import alerts).
 */
export async function notifyWatchlistArrivals(arrivals: LibraryArrival[]): Promise<void> {
  if (arrivals.length === 0) return;
  let items: MatchedItem[];
  try {
    items = await findUnnotifiedItems(arrivals);
  } catch (error) {
    reportFailure(error);
    return;
  }

  for (const arrival of arrivals) {
    const viewCap = arrival.kind === 'movie' ? 'movies.view' : 'series.view';
    // Someone may have saved the title twice (e.g. from Discover and from the
    // library page): one alert, and both items are marked.
    const byUser = new Map<string, { user: NonNullable<MatchedItem['user']>; ids: string[] }>();
    for (const item of items) {
      if (!item.user || !matches(item, arrival)) continue;
      const entry = byUser.get(item.user.id) ?? { user: item.user, ids: [] };
      entry.ids.push(item.id);
      byUser.set(item.user.id, entry);
    }

    for (const { user, ids } of byUser.values()) {
      // The push gate checks notify.watchlist per device, but the in-app copy
      // is written first, so the person must also be allowed to see the title
      // and the watchlist page the alert opens. Nobody is marked when skipped.
      if (user.status !== 'active' || !can(user, viewCap) || !can(user, 'watchlist.view') || !can(user, 'notify.watchlist')) continue;
      try {
        // The claim is the dedupe gate: when two instances import the same
        // title at once, only one poll gets a count.
        const claim = await prisma.watchlistItem.updateMany({
          where: { id: { in: ids }, availableNotifiedAt: null },
          data: { availableNotifiedAt: new Date() },
        });
        if (claim.count === 0) continue;
      } catch (error) {
        reportFailure(error);
        continue;
      }
      const focusId = ids[0];
      const url = `/watchlist?focus=${encodeURIComponent(focusId)}`;
      await notifyAndLog({
        eventType: 'watchlistAvailable',
        title: `Now in your library: ${arrival.title}`.slice(0, 200),
        body: bodyFor(arrival),
        url,
        // Per person per title: two instances that each claim a different copy
        // of the same saved title (one matched by TMDB id, one by library id)
        // still send once.
        dedupeKey: `${titleKey(arrival)}-${user.id}`,
        userIds: [user.id],
        ownerUserId: user.id,
        metadata: {
          source: arrival.kind === 'movie' ? 'radarr' : 'sonarr',
          instanceId: arrival.instanceId,
          id: focusId,
          ...(arrival.kind === 'movie' ? { movieId: arrival.arrId } : { seriesId: arrival.arrId }),
          mediaType: arrival.kind,
          // Only someone who may edit their watchlist gets the Remove button.
          ...(can(user, 'watchlist.edit') ? { watchlistItemId: focusId } : {}),
          redirect: url,
        },
      }, { service: arrival.kind === 'movie' ? 'radarr' : 'sonarr', instanceId: arrival.instanceId, reason: 'watchlist-available' });
    }
  }
}
