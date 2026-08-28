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
    const params = new URL(request.url).searchParams;
    // Two different questions: `parentId` narrows to a library, `seriesId` to
    // one show. They are not interchangeable upstream — see getNextUp.
    const parentId = params.get('parentId') ?? undefined;
    const seriesId = params.get('seriesId') ?? undefined;
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getNextUp({ limit: 40, parentId, seriesId });
    return NextResponse.json({
      linked: true,
      items: data.Items ?? [],
      total: data.TotalRecordCount ?? 0,
      startIndex: 0,
    } satisfies CatalogItemsResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, items: [], total: 0, startIndex: 0 } satisfies CatalogItemsResponse);
    }
    return upstreamErrorResponse(error, 'Failed to load next up');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/next-up');
