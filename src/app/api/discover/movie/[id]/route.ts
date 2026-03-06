import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import {
  buildLibraryLookups,
  isJapaneseAnime,
  matchMovieInLibrary,
  normalizeTmdbItem,
  annotateDiscoverItems,
  tmdbImageUrl,
} from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type {
  DiscoverMovieFullDetail,
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
      return NextResponse.json({ error: 'Invalid movie ID' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();

    const [
      details,
      externalIds,
      credits,
      videos,
      watchProvidersData,
      releaseDates,
      recommendationsData,
      similarData,
      libraryData,
    ] = await Promise.all([
      tmdb.movieDetails(id),
      tmdb.movieExternalIds(id),
      tmdb.movieCredits(id),
      tmdb.movieVideos(id),
      tmdb.movieWatchProvidersForTitle(id),
      tmdb.movieReleaseDates(id),
      tmdb.movieRecommendations(id),
      tmdb.movieSimilar(id),
      getLibraries(),
    ]);

    const lookups = buildLibraryLookups(libraryData.movies, libraryData.series);

    const library = matchMovieInLibrary(lookups, {
      tmdbId: details.id,
      imdbId: externalIds.imdb_id || details.imdb_id || null,
      title: details.title,
      year: toYear(details.release_date),
    });

    // Extract US certification
    let certification: string | null = null;
    const usRelease = releaseDates.results?.find((r) => r.iso_3166_1 === 'US');
    if (usRelease) {
      for (const rd of usRelease.release_dates) {
        if (rd.certification) {
          certification = rd.certification;
          break;
        }
      }
    }

    // Normalize similar/recommendations
    const normalizeList = (items: typeof similarData.results): DiscoverItem[] => {
      const normalized = items
        .map((item) => normalizeTmdbItem(item, 'movie'))
        .filter((item): item is DiscoverItem => item !== null);
      return annotateDiscoverItems(normalized, libraryData.movies, libraryData.series);
    };

    // Watch providers (US region)
    const usProviders = watchProvidersData.results?.['US'] ?? null;
    const mapProviders = (list?: Array<{ logo_path: string; provider_id: number; provider_name: string }>) =>
      list?.map((p) => ({
        logoPath: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
        providerId: p.provider_id,
        providerName: p.provider_name,
      }));

    // Filter videos to YouTube trailers/teasers
    const filteredVideos = (videos.results || [])
      .filter((v) => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip', 'Featurette'].includes(v.type))
      .sort((a, b) => {
        const order = ['Trailer', 'Teaser', 'Clip', 'Featurette'];
        return order.indexOf(a.type) - order.indexOf(b.type);
      })
      .slice(0, 10);

    const payload: DiscoverMovieFullDetail = {
      id: details.id,
      tmdbId: details.id,
      mediaType: 'movie',
      title: details.title,
      originalTitle: details.original_title,
      overview: details.overview || '',
      posterPath: tmdbImageUrl(details.poster_path),
      backdropPath: tmdbImageUrl(details.backdrop_path, 'w780'),
      releaseDate: details.release_date || null,
      year: toYear(details.release_date),
      rating: details.vote_average || 0,
      voteCount: details.vote_count || 0,
      popularity: details.popularity || 0,
      genres: details.genres.map((g) => g.id),
      genreNames: details.genres.map((g) => g.name),
      originalLanguage: details.original_language,
      isAnime: isJapaneseAnime(
        {
          genre_ids: details.genres.map((g) => g.id),
          original_language: details.original_language,
          origin_country: details.production_countries.map((c) => c.iso_3166_1),
        },
        'movie'
      ),
      runtime: details.runtime,
      status: details.status,
      imdbId: externalIds.imdb_id || details.imdb_id || null,
      tvdbId: null,
      productionCompanies: details.production_companies.map((c) => ({
        id: c.id,
        name: c.name,
        logoPath: c.logo_path,
      })),
      networks: [],
      library,
      addTarget: {
        service: 'radarr',
        exists: library.exists,
        id: library.id,
      },
      tagline: details.tagline || null,
      budget: details.budget || null,
      revenue: details.revenue || null,
      homepage: details.homepage || null,
      certification,
      collection: details.belongs_to_collection
        ? {
            id: details.belongs_to_collection.id,
            name: details.belongs_to_collection.name,
            posterPath: tmdbImageUrl(details.belongs_to_collection.poster_path),
            backdropPath: tmdbImageUrl(details.belongs_to_collection.backdrop_path, 'w780'),
          }
        : null,
      cast: (credits.cast || []).slice(0, 20).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character,
        profilePath: tmdbImageUrl(c.profile_path, 'w300'),
        order: c.order,
      })),
      crew: (credits.crew || [])
        .filter((c) => ['Director', 'Writer', 'Screenplay', 'Story', 'Creator'].includes(c.job))
        .map((c) => ({
          id: c.id,
          name: c.name,
          department: c.department,
          job: c.job,
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
    const message = error instanceof Error ? error.message : 'Failed to load movie detail';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
