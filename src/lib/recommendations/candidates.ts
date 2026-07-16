import type { User } from '@prisma/client';
import { getTMDBClient } from '@/lib/service-helpers';
import { loadCachedArrLibrary, fetchUserWatchStatusMap, lookupWatchStatus, type WatchStatusMapPayload } from '@/lib/jellyfin-watch-status-map';
import { arrKey, isFullyWatched } from '@/types/watch-status';
import { getTrending as getAnilistTrending } from '@/lib/anilist-client';
import type { TmdbClient, TmdbListItem } from '@/lib/tmdb-client';
import type { RadarrMovie } from '@/types';
import { normalizeGenre } from './build-profile';
import { anilistItemKey, arrItemKey, tmdbItemKey } from './item-keys';
import type { GenreVector, TasteProfile } from './profile-types';
import type { Candidate, CandidateWatchState } from './rec-types';

// Candidate sources: owned library (Sonarr/Radarr + Jellyfin watch overlay),
// TMDB discovery (seed recommendations + genre discover + trending), and
// AniList anime discovery. Each source fails soft — a missing/unreachable
// service shrinks the pool, never errors the page.

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const MAX_SEED_FANOUT = 6;
const DISCOVER_GENRES_PER_CLASS = 2;
const DISCOVER_VOTE_COUNT_MIN = 100;
// TMDB's per-title recommendations for niche seeds return obscure filler
// (live-event specials, direct-to-video sequels). A modest vote floor keeps
// them out of every rail without touching legitimately new titles much.
const SEED_REC_VOTE_COUNT_MIN = 50;
const ANIME_TRENDING_PER_PAGE = 50;

function imageOf(images: { coverType: string; remoteUrl?: string; url?: string }[] | undefined, coverType: string): string | null {
  const img = images?.find((i) => i.coverType === coverType);
  return img?.remoteUrl || img?.url || null;
}

function movieRating(movie: RadarrMovie): { rating: number | null; votes: number | null } {
  const r = movie.ratings;
  if (!r) return { rating: null, votes: null };
  const source = r.tmdb ?? r.imdb ?? r.metacritic ?? r.trakt;
  return { rating: source?.value ?? null, votes: source?.votes ?? null };
}

function watchStateOf(
  watchMap: WatchStatusMapPayload | null,
  scope: 'radarr' | 'sonarr',
  instanceId: string,
  id: number
): CandidateWatchState | undefined {
  if (!watchMap) return undefined;
  const status = lookupWatchStatus(watchMap, arrKey(scope, instanceId, id));
  if (!status) return undefined;
  if (status.kind === 'movie') {
    return { played: isFullyWatched(status), progressPct: status.playedPercentage };
  }
  return {
    played: isFullyWatched(status),
    watchedEpisodes: status.watchedEpisodeCount,
    totalEpisodes: status.totalEpisodeCount,
  };
}

export interface LibraryCandidates {
  candidates: Candidate[];
  /** tmdb:<kind>:<id> keys of everything owned — discovery candidates exclude these. */
  libraryItemKeys: Set<string>;
  watchMap: WatchStatusMapPayload | null;
}

/** Owned pool: every downloaded movie/series, tagged with watch state. */
export async function buildLibraryCandidates(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<LibraryCandidates> {
  const [library, watchMap] = await Promise.all([
    loadCachedArrLibrary(),
    fetchUserWatchStatusMap(user).catch(() => null),
  ]);

  const candidates: Candidate[] = [];
  const libraryItemKeys = new Set<string>();

  for (const movie of library.movies) {
    const tmdbId = typeof movie.tmdbId === 'number' && movie.tmdbId > 0 ? movie.tmdbId : null;
    if (tmdbId) libraryItemKeys.add(tmdbItemKey('movie', tmdbId));
    if (movie.hasFile !== true) continue;
    const { rating, votes } = movieRating(movie);
    candidates.push({
      itemKey: tmdbId ? tmdbItemKey('movie', tmdbId) : arrItemKey('radarr', movie.instanceId, movie.id),
      mediaType: 'movie',
      tmdbId: tmdbId ?? undefined,
      title: movie.title,
      year: movie.year ?? null,
      posterUrl: imageOf(movie.images, 'poster'),
      backdropUrl: imageOf(movie.images, 'fanart') ?? imageOf(movie.images, 'banner'),
      rating,
      voteCount: votes,
      popularity: movie.popularity ?? null,
      runtimeMin: movie.runtime ?? null,
      genres: movie.genres ?? [],
      overview: movie.overview ?? null,
      owned: true,
      arr: { scope: 'radarr', instanceId: movie.instanceId, id: movie.id },
      watch: watchStateOf(watchMap, 'radarr', movie.instanceId, movie.id),
      href: `/movies/${movie.id}?instance=${movie.instanceId}`,
      source: 'library',
      addedAt: movie.added ?? null,
    });
  }

  for (const series of library.series) {
    const tmdbId = typeof series.tmdbId === 'number' && series.tmdbId > 0 ? series.tmdbId : null;
    if (tmdbId) libraryItemKeys.add(tmdbItemKey('tv', tmdbId));
    if ((series.statistics?.episodeFileCount ?? 0) <= 0) continue;
    candidates.push({
      itemKey: tmdbId ? tmdbItemKey('tv', tmdbId) : arrItemKey('sonarr', series.instanceId, series.id),
      mediaType: 'tv',
      tmdbId: tmdbId ?? undefined,
      title: series.title,
      year: series.year ?? null,
      posterUrl: imageOf(series.images, 'poster'),
      backdropUrl: imageOf(series.images, 'fanart') ?? imageOf(series.images, 'banner'),
      rating: series.ratings?.value ?? null,
      voteCount: series.ratings?.votes ?? null,
      popularity: null,
      runtimeMin: series.runtime ?? null,
      genres: series.genres ?? [],
      overview: series.overview ?? null,
      owned: true,
      arr: { scope: 'sonarr', instanceId: series.instanceId, id: series.id },
      watch: watchStateOf(watchMap, 'sonarr', series.instanceId, series.id),
      href: `/series/${series.id}?instance=${series.instanceId}`,
      source: 'library',
      addedAt: series.added ?? null,
    });
  }

  return { candidates, libraryItemKeys, watchMap };
}

// ─── TMDB discovery ──────────────────────────────────────────────────────────

function tmdbToCandidate(
  item: TmdbListItem,
  mediaType: 'movie' | 'tv',
  genreNames: Map<number, string>
): Candidate | null {
  if (!item.id || item.adult) return null;
  const title = mediaType === 'movie' ? item.title : item.name;
  if (!title) return null;
  const dateRaw = mediaType === 'movie' ? item.release_date : item.first_air_date;
  const year = dateRaw ? Number(dateRaw.slice(0, 4)) : NaN;
  return {
    itemKey: tmdbItemKey(mediaType, item.id),
    mediaType,
    tmdbId: item.id,
    title,
    year: Number.isFinite(year) ? year : null,
    posterUrl: item.poster_path ? `${TMDB_POSTER_BASE}${item.poster_path}` : null,
    backdropUrl: item.backdrop_path ? `${TMDB_BACKDROP_BASE}${item.backdrop_path}` : null,
    rating: typeof item.vote_average === 'number' ? item.vote_average : null,
    voteCount: typeof item.vote_count === 'number' ? item.vote_count : null,
    popularity: typeof item.popularity === 'number' ? item.popularity : null,
    runtimeMin: null,
    genres: (item.genre_ids ?? []).map((id) => genreNames.get(id)).filter((g): g is string => Boolean(g)),
    overview: item.overview ?? null,
    owned: false,
    href: mediaType === 'movie' ? `/discover/movie/${item.id}` : `/discover/tv/${item.id}`,
    source: 'tmdb',
  };
}

function topGenres(vector: GenreVector, count: number): string[] {
  return Object.entries(vector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([genre]) => genre);
}

/** Merge duplicate candidates, accumulating seed contributions. */
function mergeCandidate(pool: Map<string, Candidate>, candidate: Candidate, seedTitle?: string, seedWeight?: number): void {
  const existing = pool.get(candidate.itemKey);
  if (!existing) {
    pool.set(candidate.itemKey, {
      ...candidate,
      seedTitles: seedTitle ? [seedTitle] : undefined,
      seedBoost: seedWeight ?? undefined,
    });
    return;
  }
  if (seedTitle && seedWeight) {
    existing.seedBoost = (existing.seedBoost ?? 0) + seedWeight;
    if (!existing.seedTitles?.includes(seedTitle)) {
      (existing.seedTitles ??= []).push(seedTitle);
    }
  }
}

/**
 * TMDB discovery pool: recommendations fanned out from the profile's top seeds
 * (multi-seed hits accumulate boost — "the kind of thing they keep watching"),
 * plus genre-targeted discover and trending. Owned titles are excluded (they
 * compete in the owned rails instead).
 */
export async function buildTmdbDiscoveryCandidates(
  profile: TasteProfile,
  libraryItemKeys: Set<string>,
  watchlistItemKeys: Set<string>
): Promise<Candidate[]> {
  let tmdb: TmdbClient;
  try {
    tmdb = await getTMDBClient();
  } catch {
    return [];
  }

  const [movieGenreList, tvGenreList] = await Promise.all([
    tmdb.movieGenres().catch(() => []),
    tmdb.tvGenres().catch(() => []),
  ]);
  const movieGenreNames = new Map(movieGenreList.map((g) => [g.id, g.name]));
  const tvGenreNames = new Map(tvGenreList.map((g) => [g.id, g.name]));
  const movieGenreIds = new Map(movieGenreList.map((g) => [normalizeGenre(g.name), g.id]));
  const tvGenreIds = new Map(tvGenreList.map((g) => [normalizeGenre(g.name), g.id]));

  const seeds = profile.seeds.filter((s) => s.tmdbId && (s.mediaType === 'movie' || s.mediaType === 'tv')).slice(0, MAX_SEED_FANOUT);

  const seedFetches = seeds.map(async (seed) => {
    const data = seed.mediaType === 'movie'
      ? await tmdb.movieRecommendations(seed.tmdbId!)
      : await tmdb.tvRecommendations(seed.tmdbId!);
    return { seed, results: data.results ?? [] };
  });

  const genreFetches: Array<Promise<{ mediaType: 'movie' | 'tv'; results: TmdbListItem[] }>> = [];
  for (const genre of topGenres(profile.movie.genres, DISCOVER_GENRES_PER_CLASS)) {
    const id = movieGenreIds.get(genre);
    if (!id) continue;
    genreFetches.push(
      tmdb.discoverMovie({ genres: [id], voteCountMin: DISCOVER_VOTE_COUNT_MIN, sortBy: 'popularity', sortOrder: 'desc' })
        .then((r) => ({ mediaType: 'movie' as const, results: r.results ?? [] }))
    );
  }
  for (const genre of topGenres(profile.tv.genres, DISCOVER_GENRES_PER_CLASS)) {
    const id = tvGenreIds.get(genre);
    if (!id) continue;
    genreFetches.push(
      tmdb.discoverTv({ genres: [id], voteCountMin: DISCOVER_VOTE_COUNT_MIN, sortBy: 'popularity', sortOrder: 'desc' })
        .then((r) => ({ mediaType: 'tv' as const, results: r.results ?? [] }))
    );
  }

  const trendingFetches = [
    tmdb.trending('movie').then((r) => ({ mediaType: 'movie' as const, results: r.results ?? [] })),
    tmdb.trending('tv').then((r) => ({ mediaType: 'tv' as const, results: r.results ?? [] })),
  ];

  const [seedResults, genreResults, trendingResults] = await Promise.all([
    Promise.allSettled(seedFetches),
    Promise.allSettled(genreFetches),
    Promise.allSettled(trendingFetches),
  ]);

  const pool = new Map<string, Candidate>();
  const blocked = (key: string) => libraryItemKeys.has(key) || watchlistItemKeys.has(key);

  for (const result of seedResults) {
    if (result.status !== 'fulfilled') continue;
    const { seed, results } = result.value;
    const genreNames = seed.mediaType === 'movie' ? movieGenreNames : tvGenreNames;
    for (const item of results) {
      const candidate = tmdbToCandidate(item, seed.mediaType as 'movie' | 'tv', genreNames);
      if (!candidate || blocked(candidate.itemKey)) continue;
      if ((candidate.voteCount ?? 0) < SEED_REC_VOTE_COUNT_MIN) continue;
      mergeCandidate(pool, candidate, seed.title, seed.weight);
    }
  }
  for (const result of [...genreResults, ...trendingResults]) {
    if (result.status !== 'fulfilled') continue;
    const { mediaType, results } = result.value;
    const genreNames = mediaType === 'movie' ? movieGenreNames : tvGenreNames;
    for (const item of results) {
      const candidate = tmdbToCandidate(item, mediaType, genreNames);
      if (!candidate || blocked(candidate.itemKey)) continue;
      mergeCandidate(pool, candidate);
    }
  }

  return [...pool.values()];
}

// ─── AniList anime discovery ─────────────────────────────────────────────────

/** Trending anime not already on the user's AniList list. */
export async function buildAnimeCandidates(listedAnilistIds: Set<number>): Promise<Candidate[]> {
  try {
    const { media } = await getAnilistTrending(1, ANIME_TRENDING_PER_PAGE);
    const candidates: Candidate[] = [];
    for (const item of media ?? []) {
      if (!item?.id || item.isAdult || listedAnilistIds.has(item.id)) continue;
      const title = item.title.english ?? item.title.romaji ?? item.title.native;
      if (!title) continue;
      candidates.push({
        itemKey: anilistItemKey(item.id),
        mediaType: 'anime',
        anilistId: item.id,
        title,
        year: item.seasonYear ?? null,
        posterUrl: item.coverImage?.extraLarge ?? item.coverImage?.large ?? null,
        backdropUrl: item.bannerImage ?? null,
        rating: item.averageScore != null ? item.averageScore / 10 : null,
        voteCount: item.popularity ?? null,
        popularity: item.trending ?? item.popularity ?? null,
        runtimeMin: item.duration ?? null,
        genres: item.genres ?? [],
        overview: null,
        owned: false,
        href: `/anime/${item.id}`,
        source: 'anilist',
      });
    }
    return candidates;
  } catch {
    return [];
  }
}
