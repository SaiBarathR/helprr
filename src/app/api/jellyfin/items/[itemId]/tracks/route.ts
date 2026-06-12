import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;

// All audio tracks under an album (itemId = albumId) in disc/track order, for
// the album detail page and music-queue building.
async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const { itemId } = await params;
  if (!ID_PATTERN.test(itemId)) {
    return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getItems({
      ParentId: itemId,
      IncludeItemTypes: 'Audio',
      Recursive: true,
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      SortOrder: 'Ascending',
      // MediaSources carries the file container, which the browser needs to
      // report DirectPlay vs Transcode for the session.
      Fields: 'MediaSources',
    });
    return NextResponse.json({ items: data.Items, linked: true });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ items: [], linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch tracks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/items/[itemId]/tracks');
