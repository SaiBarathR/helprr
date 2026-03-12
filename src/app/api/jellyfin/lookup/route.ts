import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const imdbId = searchParams.get('imdbId');
  const tvdbId = searchParams.get('tvdbId');
  const tmdbId = searchParams.get('tmdbId');

  if (!imdbId && !tvdbId && !tmdbId) {
    return NextResponse.json({ error: 'At least one provider ID required' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClient();

    // AnyProviderIdEquals is broken in Jellyfin 10.11+, so fetch all
    // movies/series with ProviderIds and match client-side.
    const result = await client.queryItems({
      IncludeItemTypes: 'Movie,Series',
      Recursive: true,
      Fields: 'ProviderIds',
      EnableImages: false,
    });

    const match = result.Items?.find((item) => {
      const pids = (item as { ProviderIds?: Record<string, string> }).ProviderIds;
      if (!pids) return false;
      if (imdbId && pids.Imdb === imdbId) return true;
      if (tvdbId && pids.Tvdb === tvdbId) return true;
      if (tmdbId && pids.Tmdb === tmdbId) return true;
      return false;
    });

    if (!match) {
      return NextResponse.json({ itemId: null });
    }

    return NextResponse.json({ itemId: match.Id });
  } catch (error) {
    const message = (error as { message?: string })?.message;
    if (message?.includes('not configured') || message?.includes('missing')) {
      return NextResponse.json({ itemId: null });
    }
    console.error('Jellyfin lookup failed:', error);
    return NextResponse.json({ error: 'Jellyfin lookup failed' }, { status: 500 });
  }
}
