import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getSeerrClient } from '@/lib/service-helpers';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import { tmdbImageUrl } from '@/lib/discover';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';

// Helprr-side pending requests awaiting admin approval. Admins (requests.approve)
// see everyone's; members see only their own.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'requests.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isApprover = can(auth.user, 'requests.approve');
  const rows = await prisma.pendingRequest.findMany({
    where: isApprover ? {} : { userId: auth.user.id },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, displayName: true } } },
  });

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

  return NextResponse.json({ results });
}

export const GET = withApiLogging(getHandler, 'api/seerr/pending-requests');
