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
    const parentId = new URL(request.url).searchParams.get('parentId') ?? undefined;
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getNextUp({ limit: 40, parentId });
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
