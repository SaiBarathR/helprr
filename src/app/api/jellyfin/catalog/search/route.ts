import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { canUserAccessLiveTv, isLiveTvItemType, withoutLiveTvItems } from '@/lib/jellyfin-playback/item-access';
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
    const client = await getJellyfinClientForUser(auth.user);
    // An account without Live TV gets no channels: drop the type, and stop if nothing is left.
    let types = (searchParams.get('includeItemTypes') || 'Movie,Series,Episode,Person,MusicArtist,MusicAlbum,Audio,Book,BoxSet,LiveTvChannel,Playlist,Video')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    if (types.some(isLiveTvItemType) && !(await canUserAccessLiveTv(auth.user))) {
      types = types.filter((type) => !isLiveTvItemType(type));
    }
    if (types.length === 0) {
      return NextResponse.json({ linked: true, items: [], total: 0, startIndex: 0 } satisfies CatalogItemsResponse);
    }
    const items = await client.getCatalogItems({
      SearchTerm: term,
      Recursive: true,
      Limit: 50,
      IncludeItemTypes: types.join(','),
    });
    const all = items.Items ?? [];
    const allowed = await withoutLiveTvItems(auth.user, all);
    return NextResponse.json({
      linked: true,
      items: allowed,
      total: Math.max(0, (items.TotalRecordCount ?? 0) - (all.length - allowed.length)),
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
