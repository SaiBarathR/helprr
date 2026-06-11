import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { prisma } from '@/lib/db';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { notifyEvent } from '@/lib/notification-service';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';
import { tmdbImageUrl } from '@/lib/discover';
import { getLibraryLookups } from '@/lib/watchlist-library-lookup';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import { parseInt32 } from '@/lib/pagination';
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

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('requests.view');
  if (!auth.ok) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;

    // Non-admins only ever see their own Seerr requests (ignore ?requestedBy=);
    // admins may filter by any user or see all. An unlinked member sees nothing.
    let requestedBy: number | undefined;
    if (auth.user.role === 'admin') {
      requestedBy = parseInt32(sp.get('requestedBy'), { min: 1 });
    } else {
      const own = auth.user.seerrUserId ? Number.parseInt(auth.user.seerrUserId, 10) : NaN;
      if (!Number.isInteger(own)) {
        return NextResponse.json({
          results: [],
          pageInfo: { page: 1, pages: 0, pageSize: 0, results: 0 },
          linked: false,
        });
      }
      requestedBy = own;
    }

    const client = await getSeerrClient();
    const data = await client.listRequests({
      take: parseInt32(sp.get('take'), { min: 1, max: MAX_PAGE_SIZE }) ?? 50,
      skip: parseInt32(sp.get('skip'), { min: 0 }) ?? 0,
      filter: parseFilter(sp.get('filter')) ?? 'all',
      sort: (sp.get('sort') === 'modified' ? 'modified' : 'added') as SeerrRequestSort,
      sortDirection: (sp.get('sortDirection') === 'asc' ? 'asc' : 'desc') as SeerrSortDirection,
      requestedBy,
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

        let helprr: { type: 'movie' | 'series'; id: number; instanceId: string } | null = null;
        if (lookups) {
          if (req.type === 'movie' && tmdbId) {
            const ref = lookups.radarrByTmdbId.get(tmdbId);
            if (ref) helprr = { type: 'movie', id: ref.id, instanceId: ref.instanceId };
          } else if (req.type === 'tv') {
            const byTvdb = tvdbId ? lookups.sonarrByTvdbId.get(tvdbId) : undefined;
            const byTmdb = tmdbId ? lookups.sonarrByTmdbId.get(tmdbId) : undefined;
            const ref = byTvdb ?? byTmdb;
            if (ref) helprr = { type: 'series', id: ref.id, instanceId: ref.instanceId };
          }
        }

        if (!tmdbId) {
          return {
            ...req,
            enriched: { title: null, year: null, posterUrl: null, helprr },
          };
        }
        // Per-item enrichment is best-effort: a single TMDB detail failure must
        // not 500 the whole list (the row just renders without metadata).
        const detail = await getCachedSeerrMediaDetail(client, req.type, tmdbId).catch(() => null);
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
  title?: unknown;
  is4k?: unknown;
  seasons?: unknown;
  // Advanced overrides (Seerr "Advanced" section).
  serverId?: unknown;
  profileId?: unknown;
  rootFolder?: unknown;
  languageProfileId?: unknown;
  tags?: unknown;
  // Admin-only: attribute the request to a specific Seerr user ("Request As").
  requestAs?: unknown;
}

function parseTags(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0);
  return out;
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
  const auth = await requireUserCapability('requests.create');
  if (!auth.ok) return auth.response;

  // Attribute to the caller's linked Seerr user. Non-admins must be linked
  // (otherwise the request would silently land on the admin's quota); admins
  // attribute to themselves when linked, else fall back to the API key's user.
  let attributeUserId: number | undefined;
  if (auth.user.seerrUserId) {
    const parsed = Number.parseInt(auth.user.seerrUserId, 10);
    if (Number.isInteger(parsed)) attributeUserId = parsed;
  }
  if (auth.user.role !== 'admin' && attributeUserId === undefined) {
    return NextResponse.json(
      { error: 'Your account is not linked to a Seerr user. Ask your admin to link it.' },
      { status: 409 }
    );
  }

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
  const parsedSeasons = parseSeasons(body.seasons);
  if (body.seasons !== undefined && parsedSeasons === undefined) {
    return NextResponse.json(
      { error: "seasons must be 'all' or an array of non-negative integers" },
      { status: 400 }
    );
  }
  // An empty array means "no seasons specified" — fall back to the 'all' default
  // (createRequest sends 'all') rather than forwarding a zero-season request.
  const seasons =
    Array.isArray(parsedSeasons) && parsedSeasons.length === 0 ? undefined : parsedSeasons;

  // Admins may attribute the request to another Seerr user via "Request As";
  // members are always pinned to their own linked account (set above).
  if (auth.user.role === 'admin' && typeof body.requestAs === 'number' && Number.isInteger(body.requestAs) && body.requestAs > 0) {
    attributeUserId = body.requestAs;
  }

  const overrides = {
    serverId: typeof body.serverId === 'number' ? body.serverId : undefined,
    profileId: typeof body.profileId === 'number' ? body.profileId : undefined,
    rootFolder: typeof body.rootFolder === 'string' && body.rootFolder ? body.rootFolder : undefined,
    languageProfileId: typeof body.languageProfileId === 'number' ? body.languageProfileId : undefined,
    tags: parseTags(body.tags),
  };

  // Approval gate: anyone WITHOUT requests.autoApprove (members by default) has
  // their request parked in Helprr for admin approval instead of hitting Seerr
  // — Seerr's API would auto-approve it (approval follows the admin API key, not
  // the attributed user). Admins (and members granted the capability) go straight through.
  if (!can(auth.user, 'requests.autoApprove')) {
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const pending = await prisma.pendingRequest.create({
      data: {
        userId: auth.user.id,
        mediaType,
        tmdbId,
        title,
        is4k,
        seasons: Array.isArray(seasons) ? seasons : undefined,
        serverId: overrides.serverId,
        profileId: overrides.profileId,
        rootFolder: overrides.rootFolder ?? null,
        languageProfileId: overrides.languageProfileId,
        tags: overrides.tags ?? undefined,
        seerrUserId: attributeUserId != null ? String(attributeUserId) : null,
      },
      select: { id: true },
    });

    // Notify every active admin that there's something to approve.
    const adminIds = (
      await prisma.user.findMany({
        where: { role: 'admin', status: 'active' },
        select: { id: true },
      })
    ).map((u) => u.id);
    await notifyEvent({
      eventType: 'requestCreated',
      title: 'New request to approve',
      body: `${auth.user.displayName} requested ${title ?? (mediaType === 'tv' ? 'a series' : 'a movie')}`,
      // Deep-link to the pending item so a notification tap (the iOS path, where
      // action buttons aren't shown) opens the approve sheet directly.
      url: `/requests?focus=${pending.id}`,
      metadata: { source: 'helprr-pending', id: pending.id, tmdbId, mediaType, redirect: `/requests?focus=${pending.id}` },
      userIds: adminIds.length ? adminIds : undefined,
    }).catch((err) => logger.warn('Pending-request notify failed', { err }, { scope: 'api/seerr/requests' }));

    return NextResponse.json({ pending: true, id: pending.id });
  }

  try {
    const client = await getSeerrClient();
    const created = await client.createRequest({
      mediaType,
      mediaId: tmdbId,
      is4k,
      seasons,
      userId: attributeUserId,
      ...overrides,
    });
    return NextResponse.json({ request: created });
  } catch (error) {
    logger.error(
      'Seerr create request failed',
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { error },
      { scope: 'api/seerr/requests' }
    );
    // Surface client-level upstream errors (e.g. 409 "already requested",
    // 400 validation) with Seerr's own status + message so the caller can tell
    // a duplicate from a genuine fault. Seerr's message is user-facing API
    // copy, not sensitive internals. Anything else stays a generic 500.
    if (isAxiosError(error) && error.response && error.response.status < 500) {
      const data = error.response.data as { message?: unknown } | undefined;
      const message =
        typeof data?.message === 'string' ? data.message : 'Seerr rejected the request';
      return NextResponse.json({ error: message }, { status: error.response.status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests');
export const POST = withApiLogging(postHandler, 'api/seerr/requests');
