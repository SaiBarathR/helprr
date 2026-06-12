import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { withApiLogging } from '@/lib/api-logger';

const SERIES_ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;

// Resolve which episode a series-level Play button should start: the caller's
// next-up episode, falling back to the first episode for untouched series.
// Scoped to the caller's own Jellyfin user, so watch state is theirs.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.play');
  if (!auth.ok) return auth.response;

  const seriesId = request.nextUrl.searchParams.get('seriesId');
  if (!seriesId || !SERIES_ID_PATTERN.test(seriesId)) {
    return NextResponse.json({ error: 'Valid seriesId is required' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const nextUp = await client.getNextUp(seriesId);
    let episode = nextUp.Items?.[0];
    if (!episode) {
      episode = (await client.getEpisodes(seriesId, { limit: 1 })).Items?.[0];
    }
    return NextResponse.json({ itemId: episode?.Id ?? null });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ itemId: null, linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to resolve next episode';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/play/next-up');
