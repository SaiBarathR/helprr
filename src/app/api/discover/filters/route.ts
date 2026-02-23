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

async function safeTmdb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TmdbRateLimitError) throw error;
    console.warn('[DiscoverFilters] TMDB partial failure:', error);
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'US';

    const tmdb = await getTMDBClient();

    const [movieGenres, tvGenres, movieProviders, tvProviders, popularTv] = await Promise.all([
      safeTmdb(() => tmdb.movieGenres(), []),
      safeTmdb(() => tmdb.tvGenres(), []),
      safeTmdb(() => tmdb.movieWatchProviders(region), []),
      safeTmdb(() => tmdb.tvWatchProviders(region), []),
      safeTmdb(
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
