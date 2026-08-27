import { NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { CatalogViewsResponse } from '@/types/jellyfin-streaming';

/** The user's libraries on their own, so Browse can list them without paying
 *  for the whole home payload. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const views = await client.getLibraries();
    return NextResponse.json({ linked: true, views } satisfies CatalogViewsResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, views: [] } satisfies CatalogViewsResponse);
    }
    return upstreamErrorResponse(error, 'Failed to list Jellyfin libraries');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/views');
