import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get('limit');
    const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(Math.floor(parsedLimit), 100))
      : 20;
    // Scoped to the caller's own Jellyfin user (like /api/jellyfin/resume) so
    // members only see items their account can access — and therefore only
    // items whose artwork the image route will serve them.
    const client = await getJellyfinClientForUser(auth.user);
    const items = await client.getRecentlyAdded({ limit });
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ items: [] });
    }
    return upstreamErrorResponse(error, 'Failed to fetch recently added');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/recently-added');
