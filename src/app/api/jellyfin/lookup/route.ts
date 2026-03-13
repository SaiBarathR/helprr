import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getJellyfinClientContext } from '@/lib/service-helpers';
import {
  getCachedJellyfinLookup,
  setCachedJellyfinLookup,
  type JellyfinLookupProvider,
} from '@/lib/cache/jellyfin-lookup-cache';

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
    const { client, connectionFingerprint } = await getJellyfinClientContext();
    const providerLookups: Array<{ provider: JellyfinLookupProvider; providerId: string }> = [];
    if (imdbId) providerLookups.push({ provider: 'imdb', providerId: imdbId });
    if (tvdbId) providerLookups.push({ provider: 'tvdb', providerId: tvdbId });
    if (tmdbId) providerLookups.push({ provider: 'tmdb', providerId: tmdbId });

    const cachedMatches = await Promise.all(
      providerLookups.map(({ provider, providerId }) =>
        getCachedJellyfinLookup(connectionFingerprint, provider, providerId)
      )
    );
    const cachedHit = cachedMatches.find((entry) => entry?.itemId);
    if (cachedHit?.itemId) {
      return NextResponse.json({ itemId: cachedHit.itemId });
    }

    if (cachedMatches.length > 0 && cachedMatches.every((entry) => entry !== null)) {
      return NextResponse.json({ itemId: null });
    }

    // AnyProviderIdEquals is broken in Jellyfin 10.11+, so fetch all
    // movies/series with ProviderIds and match client-side. This can be
    // expensive on large libraries, so provider-ID cache hits short-circuit
    // the full-library scan whenever possible.
    const result = await client.queryItems({
      IncludeItemTypes: 'Movie,Series',
      Recursive: true,
      Fields: 'ProviderIds',
      EnableImages: false,
    });

    const match = result.Items?.find((item) => {
      const pids = item.ProviderIds;
      if (!pids) return false;
      if (imdbId && pids.Imdb === imdbId) return true;
      if (tvdbId && pids.Tvdb === tvdbId) return true;
      if (tmdbId && pids.Tmdb === tmdbId) return true;
      return false;
    });

    await Promise.all(
      providerLookups.map(({ provider, providerId }) =>
        setCachedJellyfinLookup(connectionFingerprint, provider, providerId, match?.Id ?? null)
      )
    );

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
