import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getTMDBClient } from '@/lib/service-helpers';
import { parseItemKey } from '@/lib/recommendations/item-keys';

// Best YouTube trailer for a recommendation item (feed inline player).
// Returns { youtubeKey: null } when the item has no TMDB identity or no
// usable video — the client hides the trailer button.

const TYPE_ORDER = ['Trailer', 'Teaser', 'Clip', 'Featurette'];

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  const itemKey = new URL(request.url).searchParams.get('itemKey') ?? '';
  const parsed = parseItemKey(itemKey);
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid itemKey' }, { status: 400 });
  }
  if (!parsed.tmdbId || (parsed.mediaType !== 'movie' && parsed.mediaType !== 'tv')) {
    return NextResponse.json({ youtubeKey: null });
  }

  try {
    const tmdb = await getTMDBClient();
    const videos = parsed.mediaType === 'movie'
      ? await tmdb.movieVideos(parsed.tmdbId)
      : await tmdb.tvVideos(parsed.tmdbId);
    const best = (videos.results ?? [])
      .filter((v) => v.site === 'YouTube' && TYPE_ORDER.includes(v.type) && v.key)
      .sort((a, b) => {
        const official = Number(b.official ?? false) - Number(a.official ?? false);
        if (official !== 0) return official;
        return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      })[0];
    return NextResponse.json({ youtubeKey: best?.key ?? null });
  } catch {
    return NextResponse.json({ youtubeKey: null });
  }
}

export const GET = withApiLogging(getHandler, 'api/recommendations/trailer');
