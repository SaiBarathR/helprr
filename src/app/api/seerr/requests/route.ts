import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { tmdbImageUrl } from '@/lib/discover';
import { getLibraryLookups } from '@/lib/watchlist-library-lookup';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import type {
  EnrichedSeerrRequest,
  SeerrRequestFilter,
  SeerrRequestSort,
  SeerrSortDirection,
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

const MAX_PAGE_SIZE = 1000;

function parseInt32(
  value: string | null,
  opts?: { min?: number; max?: number }
): number | undefined {
  if (!value) return undefined;
  const n = Math.trunc(Number.parseInt(value, 10));
  if (!Number.isFinite(n)) return undefined;
  const min = opts?.min ?? 0;
  const max = opts?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(n, min), max);
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const sp = request.nextUrl.searchParams;
    const client = await getSeerrClient();
    const data = await client.listRequests({
      take: parseInt32(sp.get('take'), { min: 1, max: MAX_PAGE_SIZE }) ?? 50,
      skip: parseInt32(sp.get('skip'), { min: 0 }) ?? 0,
      filter: parseFilter(sp.get('filter')) ?? 'all',
      sort: (sp.get('sort') === 'modified' ? 'modified' : 'added') as SeerrRequestSort,
      sortDirection: (sp.get('sortDirection') === 'asc' ? 'asc' : 'desc') as SeerrSortDirection,
      requestedBy: parseInt32(sp.get('requestedBy'), { min: 1 }),
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

interface CreateBody {
  mediaType?: unknown;
  tmdbId?: unknown;
  is4k?: unknown;
  seasons?: unknown;
}

function parseSeasons(value: unknown): number[] | 'all' | undefined {
  if (value === undefined) return undefined;
  if (value === 'all') return 'all';
  if (!Array.isArray(value)) return undefined;
  const cleaned: number[] = [];
  for (const entry of value) {
    if (!Number.isInteger(entry) || (entry as number) < 0) return undefined;
    cleaned.push(entry as number);
  }
  return cleaned;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mediaType = body.mediaType;
  if (mediaType !== 'movie' && mediaType !== 'tv') {
    return NextResponse.json(
      { error: "mediaType must be 'movie' or 'tv'" },
      { status: 400 }
    );
  }
  const tmdbId = typeof body.tmdbId === 'number' ? body.tmdbId : Number(body.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: 'tmdbId must be a positive integer' }, { status: 400 });
  }
  const is4k = body.is4k === true;
  const seasons = parseSeasons(body.seasons);
  if (body.seasons !== undefined && seasons === undefined) {
    return NextResponse.json(
      { error: "seasons must be 'all' or an array of non-negative integers" },
      { status: 400 }
    );
  }

  try {
    const client = await getSeerrClient();
    const created = await client.createRequest({
      mediaType,
      mediaId: tmdbId,
      is4k,
      seasons,
    });
    return NextResponse.json({ request: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests');
export const POST = withApiLogging(postHandler, 'api/seerr/requests');
