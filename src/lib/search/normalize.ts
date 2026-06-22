import type { RadarrMovie, SonarrSeries, LidarrArtist, MediaImage } from '@/types';
import type { Tagged } from '@/lib/discover';
import { normalizeTitle } from '@/lib/discover';
import { watchlistHrefFor } from '@/lib/watchlist-helpers';
import { prisma } from '@/lib/db';
import type { SearchDoc } from '@/lib/search/types';

// One toDocs() per module: library list → SearchDoc[]. Capture every stable id so
// cross-module dedup (score.ts) can collapse the same title surfaced by Radarr and
// the watchlist into a single result.

function posterOf(images: MediaImage[] | undefined): string | null {
  const img = images?.find((i) => i.coverType === 'poster');
  return img?.remoteUrl || img?.url || null;
}

// A usable, positive metadata id — or undefined. The *arr APIs report 0 (and NaN
// from a bad parse) for "no id", and a 0 must NOT become a canonical key like
// `tvdb:0` that falsely merges every unmapped item in dedup. String ids use a plain
// truthy check (drops '') at each call site.
function posId(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

export function moviesToDocs(movies: Tagged<RadarrMovie>[]): SearchDoc[] {
  return movies.map((m): SearchDoc => ({
    id: `movies:${m.instanceId}:${m.id}`,
    module: 'movies',
    title: m.title,
    sortTitle: normalizeTitle(m.title),
    year: m.year ?? null,
    ids: { tmdb: posId(m.tmdbId), imdb: m.imdbId || undefined },
    subtitle: m.year ? String(m.year) : undefined,
    poster: posterOf(m.images),
    posterService: 'radarr',
    route: `/movies/${m.id}?instance=${m.instanceId}`,
  }));
}

export function seriesToDocs(series: Tagged<SonarrSeries>[]): SearchDoc[] {
  return series.map((s): SearchDoc => ({
    id: `series:${s.instanceId}:${s.id}`,
    module: 'series',
    title: s.title,
    sortTitle: normalizeTitle(s.title),
    year: s.year ?? null,
    ids: { tvdb: posId(s.tvdbId), tmdb: posId(s.tmdbId), imdb: s.imdbId || undefined },
    subtitle: s.year ? String(s.year) : undefined,
    poster: posterOf(s.images),
    posterService: 'sonarr',
    route: `/series/${s.id}?instance=${s.instanceId}`,
  }));
}

export function artistsToDocs(artists: Tagged<LidarrArtist>[]): SearchDoc[] {
  return artists.map((a): SearchDoc => ({
    id: `music:${a.instanceId}:${a.id}`,
    module: 'music',
    title: a.artistName,
    sortTitle: normalizeTitle(a.artistName),
    year: null,
    // MusicBrainz id scopes artist dedup so a band never merges into a same-named film.
    ids: { mbid: a.foreignArtistId || undefined },
    subtitle: a.disambiguation || a.artistType || undefined,
    poster: posterOf(a.images),
    posterService: 'lidarr',
    route: `/music/${a.id}?instance=${a.instanceId}`,
  }));
}

/** Watchlist is per-user, so it's queried fresh (cheap indexed read) rather than
 * cached cross-user. externalId maps to a metadata id only for discover-sourced rows. */
export async function watchlistToDocs(userId: string): Promise<SearchDoc[]> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    select: {
      id: true,
      source: true,
      externalId: true,
      mediaType: true,
      title: true,
      year: true,
      posterUrl: true,
    },
  });

  return items.map((it): SearchDoc => {
    const ids: SearchDoc['ids'] = {};
    const ext = posId(Number.parseInt(it.externalId, 10));
    if (ext !== undefined) {
      if (it.source === 'TMDB') ids.tmdb = ext;
      else if (it.source === 'TVDB') ids.tvdb = ext;
      else if (it.source === 'ANILIST') ids.anilist = ext;
      // SONARR/RADARR externalId is the arr id (not a metadata id) — fall back to title.
    }
    return {
      id: `watchlist:${it.id}`,
      module: 'watchlist',
      title: it.title,
      sortTitle: normalizeTitle(it.title),
      year: it.year ?? null,
      ids,
      subtitle: it.year ? String(it.year) : undefined,
      poster: it.posterUrl ?? null,
      posterService: it.source === 'ANILIST' ? 'anilist' : it.source === 'TMDB' ? 'tmdb' : undefined,
      route: watchlistHrefFor(it.source, it.externalId, it.mediaType) ?? '/watchlist',
    };
  });
}
