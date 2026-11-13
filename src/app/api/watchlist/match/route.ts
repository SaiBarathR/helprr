import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { resolveConnection } from '@/lib/arr-instances';
import { isValidExternalId } from '@/lib/watchlist-helpers';
import { arrItemInstanceId, getLibraryLookups } from '@/lib/watchlist-library-lookup';

const MAX_ARR_REFS = 20;

/**
 * Whether a title is on the person's watchlist, however it was saved: from
 * Discover (its TMDB/TVDB id) or from a library page (a Radarr/Sonarr id, which
 * is that title only on the instance it was saved from).
 *
 * `?mediaType=movie|series&tmdbId=&tvdbId=&arr=<instanceId>:<id>` (arr repeats;
 * an empty instance id means the default instance).
 */
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('watchlist.view');
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const mediaType = params.get('mediaType');
  if (mediaType !== 'movie' && mediaType !== 'series') {
    return NextResponse.json({ error: 'Invalid mediaType' }, { status: 400 });
  }
  const validId = (raw: string | null) => (raw && isValidExternalId(raw) ? raw : null);
  const tmdbId = validId(params.get('tmdbId'));
  const tvdbId = mediaType === 'series' ? validId(params.get('tvdbId')) : null;
  const arrRefs = params.getAll('arr').slice(0, MAX_ARR_REFS).flatMap((raw) => {
    const at = raw.lastIndexOf(':');
    const id = validId(raw.slice(at + 1));
    return at >= 0 && id ? [{ instanceId: raw.slice(0, at), id }] : [];
  });

  const arrSource = mediaType === 'movie' ? 'RADARR' : 'SONARR';
  const or = [
    ...(tmdbId ? [{ source: 'TMDB', externalId: tmdbId }] : []),
    ...(tvdbId ? [{ source: 'TVDB', externalId: tvdbId }] : []),
    ...(arrRefs.length ? [{ source: arrSource, externalId: { in: arrRefs.map((r) => r.id) } }] : []),
  ];
  if (or.length === 0) return NextResponse.json({ item: null });

  const items = await prisma.watchlistItem.findMany({
    where: { userId: auth.user.id, mediaType, OR: or },
    select: { id: true, title: true, source: true, externalId: true },
    orderBy: { addedAt: 'desc' },
  });

  let match = items.find((i) => i.source !== arrSource);
  const arrItems = items.filter((i) => i.source === arrSource);
  if (!match && arrItems.length > 0) {
    // A Radarr/Sonarr id is a different title on each instance: match it only
    // on the instance it resolves to, as its watchlist link does.
    try {
      const wanted = new Set(
        await Promise.all(arrRefs.map(async (r) => `${(await resolveConnection(arrSource, r.instanceId || null)).id}:${r.id}`)),
      );
      const lookups = await getLibraryLookups({ tmdbMovie: mediaType === 'movie', tvdbSeries: mediaType === 'series', tmdbSeries: false });
      match = arrItems.find((i) => wanted.has(`${arrItemInstanceId(i.source, i.externalId, lookups, i.title)}:${i.externalId}`));
    } catch {
      // An instance that can't be read: the title shows as not saved, and
      // saving it again only updates the existing item.
    }
  }

  return NextResponse.json({ item: match ? { id: match.id, title: match.title } : null });
}

export const GET = withApiLogging(getHandler, 'api/watchlist/match');
