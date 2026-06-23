import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getJellyfinUserContext, isJellyfinUnavailable } from '@/lib/service-helpers';
import { buildEpisodeMap, resolveJellyfinSeriesId } from '@/lib/jellyfin-watch-status';
import { getWatchStatusJson, seriesEpisodesSeed } from '@/lib/cache/jellyfin-watch-status-cache';
import type { SeriesEpisodesResponse } from '@/types/watch-status';

const NOT_FOUND: SeriesEpisodesResponse = { linked: true, found: false, jellyfinSeriesId: null, episodes: {} };
const UNLINKED: SeriesEpisodesResponse = { linked: false, found: false, jellyfinSeriesId: null, episodes: {} };

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const imdbId = searchParams.get('imdbId');
  const tvdbId = searchParams.get('tvdbId');
  const tmdbId = searchParams.get('tmdbId');
  if (!imdbId && !tvdbId && !tmdbId) {
    return NextResponse.json({ error: 'At least one provider ID required' }, { status: 400 });
  }

  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    const jellyfinSeriesId = await resolveJellyfinSeriesId(client, connectionFingerprint, { imdbId, tvdbId, tmdbId });
    if (!jellyfinSeriesId) return NextResponse.json(NOT_FOUND);

    const seed = seriesEpisodesSeed(connectionFingerprint, jellyfinUserId, jellyfinSeriesId);
    const episodes = await getWatchStatusJson(seed, async () => {
      const result = await client.getSeriesEpisodes(jellyfinSeriesId);
      return buildEpisodeMap(result.Items ?? []);
    });

    return NextResponse.json({
      linked: true,
      found: true,
      jellyfinSeriesId,
      episodes,
    } satisfies SeriesEpisodesResponse);
  } catch (error) {
    if (isJellyfinUnavailable(error)) return NextResponse.json(UNLINKED);
    console.error('Jellyfin series watch-status failed:', error);
    return NextResponse.json(UNLINKED);
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/watch-status/series');
