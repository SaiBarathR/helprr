import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { buildLibraryLookups, matchMovieInLibrary, matchSeriesInLibrary, tmdbImageUrl } from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { DiscoverDetail, RadarrMovie, SonarrSeries } from '@/types';

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const mediaType = searchParams.get('mediaType');
    const idStr = searchParams.get('id');
    const id = idStr ? Number.parseInt(idStr, 10) : Number.NaN;

    if (!mediaType || !['movie', 'tv'].includes(mediaType) || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid mediaType or id' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();
    const { movies, series } = await getLibraries();
    const lookups = buildLibraryLookups(movies, series);

    if (mediaType === 'movie') {
      const [details, externalIds] = await Promise.all([
        tmdb.movieDetails(id),
        tmdb.movieExternalIds(id),
      ]);

      const library = matchMovieInLibrary(lookups, {
        tmdbId: details.id,
        imdbId: externalIds.imdb_id || details.imdb_id || null,
        title: details.title,
        year: toYear(details.release_date),
      });

      const payload: DiscoverDetail = {
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
        genres: details.genres.map((genre) => genre.id),
        genreNames: details.genres.map((genre) => genre.name),
        originalLanguage: details.original_language,
        isAnime: details.genres.some((genre) => genre.id === 16)
          && (details.original_language === 'ja' || details.production_countries.some((country) => country.iso_3166_1 === 'JP')),
        runtime: details.runtime,
        status: details.status,
        imdbId: externalIds.imdb_id || details.imdb_id || null,
        tvdbId: null,
        productionCompanies: details.production_companies.map((company) => ({
          id: company.id,
          name: company.name,
          logoPath: company.logo_path,
        })),
        networks: [],
        library,
        addTarget: {
          service: 'radarr',
          exists: library.exists,
          id: library.id,
        },
      };

      return NextResponse.json(payload);
    }

    const [details, externalIds] = await Promise.all([
      tmdb.tvDetails(id),
      tmdb.tvExternalIds(id),
    ]);

    const library = matchSeriesInLibrary(lookups, {
      tmdbId: details.id,
      tvdbId: externalIds.tvdb_id,
      imdbId: externalIds.imdb_id,
      title: details.name,
      year: toYear(details.first_air_date),
    });

    const payload: DiscoverDetail = {
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
      genres: details.genres.map((genre) => genre.id),
      genreNames: details.genres.map((genre) => genre.name),
      originalLanguage: details.original_language,
      originCountry: details.origin_country || [],
      isAnime: details.genres.some((genre) => genre.id === 16)
        && (details.origin_country || []).includes('JP'),
      runtime: details.episode_run_time?.[0] ?? null,
      status: details.status || null,
      imdbId: externalIds.imdb_id || null,
      tvdbId: externalIds.tvdb_id || null,
      productionCompanies: details.production_companies.map((company) => ({
        id: company.id,
        name: company.name,
        logoPath: company.logo_path,
      })),
      networks: details.networks.map((network) => ({
        id: network.id,
        name: network.name,
        logoPath: network.logo_path,
      })),
      library,
      addTarget: {
        service: 'sonarr',
        exists: library.exists,
        id: library.id,
      },
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

    const message = error instanceof Error ? error.message : 'Failed to load item';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
