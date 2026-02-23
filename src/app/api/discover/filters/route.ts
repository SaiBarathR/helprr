import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient } from '@/lib/service-helpers';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { DiscoverFiltersResponse } from '@/types';

const REGION_OPTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'BR', name: 'Brazil' },
];

const LANGUAGE_OPTIONS = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
];

const FILTERS_CACHE_TTL_MS = 10 * 60 * 1000;
let filtersCache:
  | {
      region: string;
      data: DiscoverFiltersResponse;
      expiresAt: number;
    }
  | null = null;

async function safeTmdb<T>(
  label: string,
  partialFailures: Set<string>,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TmdbRateLimitError) throw error;
    partialFailures.add(label);
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'US';
    const now = Date.now();

    if (filtersCache && filtersCache.region === region && now < filtersCache.expiresAt) {
      return NextResponse.json(filtersCache.data);
    }

    const tmdb = await getTMDBClient();
    const partialFailures = new Set<string>();

    const [movieGenres, tvGenres, movieProviders, tvProviders, popularTv] = await Promise.all([
      safeTmdb('movie_genres', partialFailures, () => tmdb.movieGenres(), []),
      safeTmdb('tv_genres', partialFailures, () => tmdb.tvGenres(), []),
      safeTmdb('movie_providers', partialFailures, () => tmdb.movieWatchProviders(region), []),
      safeTmdb('tv_providers', partialFailures, () => tmdb.tvWatchProviders(region), []),
      safeTmdb(
        'popular_tv',
        partialFailures,
        () => tmdb.discoverTv({ page: 1, sortBy: 'popularity', sortOrder: 'desc' }),
        { page: 1, total_pages: 1, total_results: 0, results: [] }
      ),
    ]);

    const genres: DiscoverFiltersResponse['genres'] = [
      ...movieGenres.map((genre) => ({ id: genre.id, name: genre.name, type: 'movie' as const })),
      ...tvGenres.map((genre) => ({ id: genre.id, name: genre.name, type: 'tv' as const })),
    ];

    const providers: DiscoverFiltersResponse['providers'] = [
      ...movieProviders.map((provider) => ({
        id: provider.provider_id,
        name: provider.provider_name,
        logoPath: provider.logo_path,
        displayPriority: provider.display_priority,
        type: 'movie' as const,
      })),
      ...tvProviders.map((provider) => ({
        id: provider.provider_id,
        name: provider.provider_name,
        logoPath: provider.logo_path,
        displayPriority: provider.display_priority,
        type: 'tv' as const,
      })),
    ];

    const networkCandidates = popularTv.results.slice(0, 10);
    const networkDetails = await Promise.all(
      networkCandidates.map(async (item) => {
        try {
          const details = await tmdb.tvDetails(item.id);
          return details.networks || [];
        } catch {
          return [];
        }
      })
    );

    const networkMap = new Map<number, { id: number; name: string; logoPath: string | null }>();
    for (const networks of networkDetails) {
      for (const network of networks) {
        if (!networkMap.has(network.id)) {
          networkMap.set(network.id, {
            id: network.id,
            name: network.name,
            logoPath: network.logo_path,
          });
        }
      }
    }

    const response: DiscoverFiltersResponse = {
      genres,
      providers,
      networks: [...networkMap.values()],
      regions: REGION_OPTIONS,
      languages: LANGUAGE_OPTIONS,
      releaseStates: [
        { value: 'released', label: 'Released' },
        { value: 'upcoming', label: 'Upcoming' },
        { value: 'airing', label: 'Airing' },
        { value: 'ended', label: 'Ended' },
      ],
    };

    const hasUsableData = response.genres.length > 0 || response.providers.length > 0 || response.networks.length > 0;

    if (partialFailures.size > 0) {
      console.warn(
        `[DiscoverFilters] TMDB partial failures (${partialFailures.size}): ${[...partialFailures].join(', ')}`
      );
    }

    if (hasUsableData) {
      filtersCache = {
        region,
        data: response,
        expiresAt: now + FILTERS_CACHE_TTL_MS,
      };
      return NextResponse.json(response);
    }

    if (filtersCache && filtersCache.region === region) {
      return NextResponse.json(filtersCache.data);
    }

    return NextResponse.json(response);
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

    const message = error instanceof Error ? error.message : 'Failed to load discover filters';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
