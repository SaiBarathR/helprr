import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('q')?.trim() ?? '';
    if (term.length < 1) {
      return NextResponse.json({ linked: true, items: [], total: 0, startIndex: 0 } satisfies CatalogItemsResponse);
    }
    const includeItemTypes = searchParams.get('includeItemTypes') ?? undefined;
    const client = await getJellyfinClientForUser(auth.user);
    const items = await client.getCatalogItems({
      SearchTerm: term,
      Recursive: true,
      Limit: 50,
      IncludeItemTypes: includeItemTypes || 'Movie,Series,Episode,Person,MusicArtist,MusicAlbum,Audio,Book,BoxSet,LiveTvChannel,Playlist,Video',
    });
    return NextResponse.json({
      linked: true,
      items: items.Items ?? [],
      total: items.TotalRecordCount ?? 0,
      startIndex: 0,
    } satisfies CatalogItemsResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, items: [], total: 0, startIndex: 0 } satisfies CatalogItemsResponse);
    }
    return upstreamErrorResponse(error, 'Failed to search Jellyfin');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/search');
