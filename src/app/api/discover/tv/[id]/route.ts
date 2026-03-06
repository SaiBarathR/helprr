import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import {
  buildLibraryLookups,
  isJapaneseAnime,
  matchSeriesInLibrary,
  normalizeTmdbItem,
  annotateDiscoverItems,
  tmdbImageUrl,
} from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type {
  DiscoverTvFullDetail,
  DiscoverItem,
  RadarrMovie,
  SonarrSeries,
} from '@/types';

function toYear(value?: string | null) {
  if (!value) return null;
  const n = Number(value.slice(0, 4));
  return Number.isFinite(n) ? n : null;
}

async function getLibraries() {
  const [movies, series] = await Promise.all([
    (async () => {
      try {
        const client = await getRadarrClient();
        return await client.getMovies();
      } catch {
        return [] as RadarrMovie[];
      }
    })(),
    (async () => {
      try {
        const client = await getSonarrClient();
        return await client.getSeries();
      } catch {
        return [] as SonarrSeries[];
      }
    })(),
  ]);
  return { movies, series };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid TV ID' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();

    const [
      details,
      externalIds,
      aggregateCredits,
      videos,
      watchProvidersData,
      contentRatings,
      recommendationsData,
      similarData,
      libraryData,
    ] = await Promise.all([
      tmdb.tvDetails(id),
      tmdb.tvExternalIds(id),
      tmdb.tvAggregateCredits(id),
      tmdb.tvVideos(id),
      tmdb.tvWatchProvidersForTitle(id),
      tmdb.tvContentRatings(id),
      tmdb.tvRecommendations(id),
      tmdb.tvSimilar(id),
      getLibraries(),
    ]);

    const lookups = buildLibraryLookups(libraryData.movies, libraryData.series);

    const library = matchSeriesInLibrary(lookups, {
      tmdbId: details.id,
      tvdbId: externalIds.tvdb_id,
      imdbId: externalIds.imdb_id,
      title: details.name,
      year: toYear(details.first_air_date),
    });

    // Extract US content rating
    let certification: string | null = null;
    const usRating = contentRatings.results?.find((r) => r.iso_3166_1 === 'US');
    if (usRating?.rating) {
      certification = usRating.rating;
    }

    const normalizeList = (items: typeof similarData.results): DiscoverItem[] => {
      const normalized = items
        .map((item) => normalizeTmdbItem(item, 'tv'))
        .filter((item): item is DiscoverItem => item !== null);
      return annotateDiscoverItems(normalized, libraryData.movies, libraryData.series);
    };

    const usProviders = watchProvidersData.results?.['US'] ?? null;
    const mapProviders = (list?: Array<{ logo_path: string; provider_id: number; provider_name: string }>) =>
      list?.map((p) => ({
        logoPath: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
        providerId: p.provider_id,
        providerName: p.provider_name,
      }));

    const filteredVideos = (videos.results || [])
      .filter((v) => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip', 'Featurette'].includes(v.type))
      .sort((a, b) => {
        const order = ['Trailer', 'Teaser', 'Clip', 'Featurette'];
        return order.indexOf(a.type) - order.indexOf(b.type);
      })
      .slice(0, 10);

    const payload: DiscoverTvFullDetail = {
      id: details.id,
      tmdbId: details.id,
      mediaType: 'tv',
      title: details.name,
      originalTitle: details.original_name,
      overview: details.overview || '',
      posterPath: tmdbImageUrl(details.poster_path),
      backdropPath: tmdbImageUrl(details.backdrop_path, 'w780'),
      releaseDate: details.first_air_date || null,
      year: toYear(details.first_air_date),
      rating: details.vote_average || 0,
      voteCount: details.vote_count || 0,
      popularity: details.popularity || 0,
      genres: details.genres.map((g) => g.id),
      genreNames: details.genres.map((g) => g.name),
      originalLanguage: details.original_language,
      originCountry: details.origin_country || [],
      isAnime: isJapaneseAnime(
        {
          genre_ids: details.genres.map((g) => g.id),
          original_language: details.original_language,
          origin_country: details.origin_country || [],
        },
        'tv'
      ),
      runtime: details.episode_run_time?.[0] ?? null,
      status: details.status || null,
      imdbId: externalIds.imdb_id || null,
      tvdbId: externalIds.tvdb_id || null,
      productionCompanies: details.production_companies.map((c) => ({
        id: c.id,
        name: c.name,
        logoPath: c.logo_path,
      })),
      networks: details.networks.map((n) => ({
        id: n.id,
        name: n.name,
        logoPath: n.logo_path,
      })),
      library,
      addTarget: {
        service: 'sonarr',
        exists: library.exists,
        id: library.id,
      },
      tagline: details.tagline || null,
      homepage: details.homepage || null,
      certification,
      createdBy: (details.created_by || []).map((c) => ({
        id: c.id,
        name: c.name,
        profilePath: tmdbImageUrl(c.profile_path, 'w300'),
      })),
      numberOfSeasons: details.number_of_seasons || 0,
      numberOfEpisodes: details.number_of_episodes || 0,
      lastAirDate: details.last_air_date || null,
      nextEpisode: details.next_episode_to_air
        ? {
            name: details.next_episode_to_air.name,
            airDate: details.next_episode_to_air.air_date || null,
            episodeNumber: details.next_episode_to_air.episode_number,
            seasonNumber: details.next_episode_to_air.season_number,
          }
        : null,
      showType: details.type || null,
      seasons: (details.seasons || []).map((s) => ({
        id: s.id,
        airDate: s.air_date,
        episodeCount: s.episode_count,
        name: s.name,
        overview: s.overview,
        posterPath: tmdbImageUrl(s.poster_path, 'w300'),
        seasonNumber: s.season_number,
        voteAverage: s.vote_average,
      })),
      cast: (aggregateCredits.cast || []).slice(0, 20).map((c) => ({
        id: c.id,
        name: c.name,
        profilePath: tmdbImageUrl(c.profile_path, 'w300'),
        character: c.roles?.[0]?.character || '',
        episodeCount: c.total_episode_count,
        order: c.order,
      })),
      crew: (aggregateCredits.crew || [])
        .filter((c) => {
          const jobs = c.jobs?.map((j) => j.job) || [];
          return jobs.some((j) => ['Director', 'Writer', 'Creator', 'Executive Producer', 'Showrunner'].includes(j));
        })
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          name: c.name,
          department: c.department,
          job: c.jobs?.[0]?.job || c.department,
          profilePath: tmdbImageUrl(c.profile_path, 'w300'),
        })),
      videos: filteredVideos.map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type,
        official: v.official,
      })),
      similar: normalizeList(similarData.results || []).slice(0, 12),
      recommendations: normalizeList(recommendationsData.results || []).slice(0, 12),
      watchProviders: usProviders
        ? {
            link: usProviders.link,
            flatrate: mapProviders(usProviders.flatrate),
            rent: mapProviders(usProviders.rent),
            buy: mapProviders(usProviders.buy),
          }
        : null,
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to load TV detail';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
