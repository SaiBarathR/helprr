import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getSeerrClient } from '@/lib/service-helpers';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import { tmdbImageUrl } from '@/lib/discover';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';
import { parseSkipTake, buildPageInfo } from '@/lib/pagination';

// Helprr-side pending requests awaiting admin approval. Admins (requests.approve)
// see everyone's; members see only their own.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('requests.view');
  if (!auth.ok) return auth.response;

  const isApprover = can(auth.user, 'requests.approve');
  const where = isApprover ? {} : { userId: auth.user.id };
  const sp = request.nextUrl.searchParams;

  // Lightweight mode: just the {mediaType, tmdbId} keys, no Seerr enrichment and no
  // pagination — used to seed the "Requested" indicator set, which needs every key.
  // Cheap even with many rows; avoids the per-row enrichment below.
  if (sp.get('fields') === 'keys') {
    const keys = await prisma.pendingRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, mediaType: true, tmdbId: true },
    });
    return NextResponse.json({ results: keys });
  }

  // Paginated, enriched list for the approval section. Bounds the per-row Seerr
  // enrichment (Promise.all below) to a page at a time.
  const { skip, take } = parseSkipTake(sp, { defaultTake: 20, maxTake: 100 });
  const [rows, total] = await Promise.all([
    prisma.pendingRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { user: { select: { id: true, displayName: true } } },
    }),
    prisma.pendingRequest.count({ where }),
  ]);

  // Best-effort enrichment (poster/year/title) from Seerr, like the requests list.
  let client: Awaited<ReturnType<typeof getSeerrClient>> | null = null;
  try {
    client = await getSeerrClient();
  } catch {
    client = null;
  }

  const results = await Promise.all(
    rows.map(async (r) => {
      let title = r.title;
      let year: number | null = null;
      let posterUrl: string | null = r.posterUrl;
      if (client) {
        try {
          const detail = await getCachedSeerrMediaDetail(client, r.mediaType as 'movie' | 'tv', r.tmdbId);
          title = detail?.title ?? detail?.name ?? title;
          const dateStr = r.mediaType === 'movie' ? detail?.releaseDate : detail?.firstAirDate;
          year = dateStr ? Number.parseInt(dateStr.slice(0, 4), 10) || null : null;
          posterUrl = tmdbImageUrl(detail?.posterPath ?? null, 'w300') ?? posterUrl;
        } catch (err) {
          logger.debug('Pending-request enrich failed', { err, id: r.id }, { scope: 'api/seerr/pending-requests' });
        }
      }
      return {
        id: r.id,
        mediaType: r.mediaType as 'movie' | 'tv',
        tmdbId: r.tmdbId,
        title,
        year,
        posterUrl,
        is4k: r.is4k,
        seasons: r.seasons,
        serverId: r.serverId,
        profileId: r.profileId,
        rootFolder: r.rootFolder,
        tags: r.tags,
        seerrUserId: r.seerrUserId,
        createdAt: r.createdAt,
        requester: r.user ? { id: r.user.id, displayName: r.user.displayName } : null,
      };
    })
  );

  return NextResponse.json({ results, pageInfo: buildPageInfo(total, skip, take) });
}

export const GET = withApiLogging(getHandler, 'api/seerr/pending-requests');
