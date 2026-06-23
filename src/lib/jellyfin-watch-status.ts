import type { JellyfinClient } from '@/lib/jellyfin-client';
import type { JellyfinItem } from '@/types/jellyfin';
import type { Tagged } from '@/lib/cache/tagged-library';
import type { RadarrMovie, SonarrSeries } from '@/types';
import {
  getCachedJellyfinLookup,
  setCachedJellyfinLookup,
  type JellyfinLookupProvider,
} from '@/lib/cache/jellyfin-lookup-cache';
import {
  anilistKey,
  arrKey,
  episodeKey,
  providerKey,
  type EpisodeWatchStatus,
  type MovieWatchStatus,
  type SeriesWatchStatus,
  type WatchStatus,
} from '@/types/watch-status';

// Build the provider/arr-id/anilist-keyed watch-status map by matching the arr
// library into a Jellyfin Movie + Series scan. Matching is BY PROVIDER ID ONLY
// (no fuzzy title/year) — a wrong match would show a false "watched" and could
// drive a wrong write-back. Status objects are de-duped by Jellyfin item id;
// many aliases point at one object.

function toMovieStatus(item: JellyfinItem): MovieWatchStatus {
  return {
    kind: 'movie',
    jellyfinItemId: item.Id,
    played: Boolean(item.UserData?.Played),
    playedPercentage: Math.round(item.UserData?.PlayedPercentage ?? 0),
  };
}

function toSeriesStatus(item: JellyfinItem): SeriesWatchStatus {
  // Both counts come from Jellyfin so the ratio is internally consistent
  // (mixing Sonarr's episode count with Jellyfin's unplayed count is nonsense).
  // RecursiveItemCount/UnplayedItemCount include specials — kept as-is so X/Y
  // never disagrees with itself.
  const total = item.RecursiveItemCount ?? 0;
  const unplayed = item.UserData?.UnplayedItemCount ?? 0;
  return {
    kind: 'series',
    jellyfinItemId: item.Id,
    played: Boolean(item.UserData?.Played),
    watchedEpisodeCount: Math.max(0, total - unplayed),
    totalEpisodeCount: total,
  };
}

/** Index Jellyfin items by each provider id they carry (keys are Tmdb/Tvdb/Imdb). */
function indexByProvider(items: JellyfinItem[]): {
  byTmdb: Map<string, JellyfinItem>;
  byTvdb: Map<string, JellyfinItem>;
  byImdb: Map<string, JellyfinItem>;
} {
  const byTmdb = new Map<string, JellyfinItem>();
  const byTvdb = new Map<string, JellyfinItem>();
  const byImdb = new Map<string, JellyfinItem>();
  // First-wins on duplicate provider ids, matching resolveJellyfinSeriesId's
  // find-first, so the two resolution paths agree on which item a duplicated
  // provider id maps to (keeps the per-series episode cache invalidation aligned
  // with the aggregate map).
  for (const item of items) {
    const pids = item.ProviderIds;
    if (!pids) continue;
    if (pids.Tmdb && !byTmdb.has(pids.Tmdb)) byTmdb.set(pids.Tmdb, item);
    if (pids.Tvdb && !byTvdb.has(pids.Tvdb)) byTvdb.set(pids.Tvdb, item);
    if (pids.Imdb && !byImdb.has(pids.Imdb.toLowerCase())) byImdb.set(pids.Imdb.toLowerCase(), item);
  }
  return { byTmdb, byTvdb, byImdb };
}

export function buildWatchStatusMap(
  library: { movies: Tagged<RadarrMovie>[]; series: Tagged<SonarrSeries>[] },
  jfMovies: JellyfinItem[],
  jfSeries: JellyfinItem[],
  anilistBySeries: Map<string, number[]>
): { items: WatchStatus[]; keys: Record<string, number> } {
  const items: WatchStatus[] = [];
  const keys: Record<string, number> = {};
  const indexByJfId = new Map<string, number>();

  const ensure = (item: JellyfinItem, make: (i: JellyfinItem) => WatchStatus): number => {
    let idx = indexByJfId.get(item.Id);
    if (idx === undefined) {
      idx = items.length;
      items.push(make(item));
      indexByJfId.set(item.Id, idx);
    }
    return idx;
  };

  const movieIdx = indexByProvider(jfMovies);
  for (const movie of library.movies) {
    const match =
      (movie.tmdbId ? movieIdx.byTmdb.get(String(movie.tmdbId)) : undefined)
      ?? (movie.imdbId ? movieIdx.byImdb.get(movie.imdbId.toLowerCase()) : undefined);
    if (!match) continue;
    const idx = ensure(match, toMovieStatus);
    if (movie.tmdbId) keys[providerKey('movie', 'tmdb', movie.tmdbId)] = idx;
    if (movie.imdbId) keys[providerKey('movie', 'imdb', movie.imdbId)] = idx;
    keys[arrKey('radarr', movie.instanceId, movie.id)] = idx;
  }

  const seriesIdx = indexByProvider(jfSeries);
  for (const series of library.series) {
    const match =
      (series.tvdbId ? seriesIdx.byTvdb.get(String(series.tvdbId)) : undefined)
      ?? (series.tmdbId ? seriesIdx.byTmdb.get(String(series.tmdbId)) : undefined)
      ?? (series.imdbId ? seriesIdx.byImdb.get(series.imdbId.toLowerCase()) : undefined);
    if (!match) continue;
    const idx = ensure(match, toSeriesStatus);
    if (series.tvdbId) keys[providerKey('series', 'tvdb', series.tvdbId)] = idx;
    if (series.tmdbId) keys[providerKey('series', 'tmdb', series.tmdbId)] = idx;
    if (series.imdbId) keys[providerKey('series', 'imdb', series.imdbId)] = idx;
    keys[arrKey('sonarr', series.instanceId, series.id)] = idx;
    for (const mediaId of anilistBySeries.get(`${series.instanceId}:${series.id}`) ?? []) {
      keys[anilistKey(mediaId)] = idx;
    }
  }

  return { items, keys };
}

/** Per-episode map keyed `S{season}E{episode}` (episodes lack provider ids → matched by number). */
export function buildEpisodeMap(episodes: JellyfinItem[]): Record<string, EpisodeWatchStatus> {
  const out: Record<string, EpisodeWatchStatus> = {};
  for (const ep of episodes) {
    if (ep.ParentIndexNumber == null || ep.IndexNumber == null) continue;
    out[episodeKey(ep.ParentIndexNumber, ep.IndexNumber)] = {
      jellyfinItemId: ep.Id,
      played: Boolean(ep.UserData?.Played),
      playedPercentage: Math.round(ep.UserData?.PlayedPercentage ?? 0),
    };
  }
  return out;
}

/**
 * Resolve a series' Jellyfin item id from its provider ids, reusing the shared
 * jellyfin-lookup cache (so this and /api/jellyfin/lookup never double-scan).
 * Returns null when the series isn't in Jellyfin.
 */
export async function resolveJellyfinSeriesId(
  client: JellyfinClient,
  connectionFingerprint: string,
  ids: { imdbId?: string | null; tvdbId?: string | null; tmdbId?: string | null }
): Promise<string | null> {
  const lookups: Array<{ provider: JellyfinLookupProvider; providerId: string }> = [];
  if (ids.imdbId) lookups.push({ provider: 'imdb', providerId: ids.imdbId });
  if (ids.tvdbId) lookups.push({ provider: 'tvdb', providerId: ids.tvdbId });
  if (ids.tmdbId) lookups.push({ provider: 'tmdb', providerId: ids.tmdbId });
  if (lookups.length === 0) return null;

  // Scope the lookup cache to 'series': the shared jellyfin-lookup cache key
  // omits item type, and /api/jellyfin/lookup populates it from a Movie+Series
  // scan, so an unscoped read could hand back a movie's item id for a series
  // (and vice-versa) when a movie and series share a provider id (tmdb).
  const cached = await Promise.all(
    lookups.map(({ provider, providerId }) =>
      getCachedJellyfinLookup(connectionFingerprint, provider, providerId, 'series'))
  );
  const hit = cached.find((entry) => entry?.itemId);
  if (hit?.itemId) return hit.itemId;
  // Every provider id resolved to a cached "not found" → trust it, skip the scan.
  if (cached.length > 0 && cached.every((entry) => entry !== null)) return null;

  const result = await client.queryItems({
    IncludeItemTypes: 'Series',
    Recursive: true,
    Fields: 'ProviderIds',
    EnableImages: false,
  });
  const match = result.Items?.find((item) => {
    const pids = item.ProviderIds;
    if (!pids) return false;
    // imdb compared case-insensitively to match indexByProvider (Sonarr and
    // Jellyfin can disagree on tt-id casing); tvdb/tmdb are numeric strings.
    if (ids.imdbId && pids.Imdb?.toLowerCase() === ids.imdbId.toLowerCase()) return true;
    if (ids.tvdbId && pids.Tvdb === ids.tvdbId) return true;
    if (ids.tmdbId && pids.Tmdb === ids.tmdbId) return true;
    return false;
  });

  await Promise.all(
    lookups.map(({ provider, providerId }) =>
      setCachedJellyfinLookup(connectionFingerprint, provider, providerId, match?.Id ?? null, 'series')
    )
  );
  return match?.Id ?? null;
}
