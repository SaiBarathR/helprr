import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogFiltersResponse } from '@/types/jellyfin-streaming';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const parentId = new URL(request.url).searchParams.get('parentId') ?? undefined;
    const client = await getJellyfinClientForUser(auth.user);
    const filters = await client.getItemFilters(parentId);
    return NextResponse.json({
      linked: true,
      genres: filters.Genres ?? [],
      years: filters.Years ?? [],
      officialRatings: filters.OfficialRatings ?? [],
      tags: filters.Tags ?? [],
    } satisfies CatalogFiltersResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({
        linked: false,
        genres: [],
        years: [],
        officialRatings: [],
        tags: [],
      } satisfies CatalogFiltersResponse);
    }
    return upstreamErrorResponse(error, 'Failed to load Jellyfin filters');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/filters');
