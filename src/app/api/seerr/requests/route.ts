import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { tmdbImageUrl } from '@/lib/discover';
import { getLibraryLookups } from '@/lib/watchlist-library-lookup';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import type {
  SeerrRequestFilter,
  SeerrRequestSort,
  SeerrSortDirection,
  SeerrRequest,
} from '@/types/seerr';

const VALID_FILTERS: SeerrRequestFilter[] = [
  'all',
  'approved',
  'pending',
  'available',
  'processing',
  'unavailable',
  'failed',
];

function parseFilter(value: string | null): SeerrRequestFilter | undefined {
  if (!value) return undefined;
  return (VALID_FILTERS as string[]).includes(value) ? (value as SeerrRequestFilter) : undefined;
}

function parseInt32(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface EnrichedSeerrRequest extends SeerrRequest {
  enriched: {
    title: string | null;
    year: number | null;
    posterUrl: string | null;
    helprr: { type: 'movie' | 'series'; id: number } | null;
  };
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const sp = request.nextUrl.searchParams;
    const client = await getSeerrClient();
    const data = await client.listRequests({
      take: parseInt32(sp.get('take')) ?? 50,
      skip: parseInt32(sp.get('skip')) ?? 0,
      filter: parseFilter(sp.get('filter')) ?? 'all',
      sort: (sp.get('sort') === 'modified' ? 'modified' : 'added') as SeerrRequestSort,
      sortDirection: (sp.get('sortDirection') === 'asc' ? 'asc' : 'desc') as SeerrSortDirection,
      requestedBy: parseInt32(sp.get('requestedBy')),
    });

    // Best-effort library lookup so we can deep-link each request into Helprr's
    // own /movies/{id} or /series/{id} page when the media already exists in
    // Sonarr/Radarr. Failures are non-fatal — rows just don't get the helprr id.
    const lookups = await getLibraryLookups({
      tmdbMovie: true,
      tvdbSeries: true,
      tmdbSeries: true,
    }).catch(() => null);

    const enriched = await Promise.all(
      data.results.map(async (req): Promise<EnrichedSeerrRequest> => {
        const tmdbId = req.media?.tmdbId;
        const tvdbId = req.media?.tvdbId ?? null;

        let helprr: { type: 'movie' | 'series'; id: number } | null = null;
        if (lookups) {
          if (req.type === 'movie' && tmdbId) {
            const id = lookups.radarrByTmdbId.get(tmdbId);
            if (id) helprr = { type: 'movie', id };
          } else if (req.type === 'tv') {
            const byTvdb = tvdbId ? lookups.sonarrByTvdbId.get(tvdbId) : undefined;
            const byTmdb = tmdbId ? lookups.sonarrByTmdbId.get(tmdbId) : undefined;
            const id = byTvdb ?? byTmdb;
            if (id) helprr = { type: 'series', id };
          }
        }

        if (!tmdbId) {
          return {
            ...req,
            enriched: { title: null, year: null, posterUrl: null, helprr },
          };
        }
        const detail = await getCachedSeerrMediaDetail(client, req.type, tmdbId);
        const dateStr = req.type === 'movie' ? detail?.releaseDate : detail?.firstAirDate;
        const year = dateStr ? Number.parseInt(dateStr.slice(0, 4), 10) || null : null;
        return {
          ...req,
          enriched: {
            title: detail?.title ?? detail?.name ?? null,
            year,
            posterUrl: tmdbImageUrl(detail?.posterPath ?? null, 'w300'),
            helprr,
          },
        };
      })
    );

    return NextResponse.json({
      pageInfo: data.pageInfo,
      results: enriched,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch requests';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests');
