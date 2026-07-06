import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('jellyfin.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get('limit');
    const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(Math.floor(parsedLimit), 100))
      : 20;
    const client = await getJellyfinClient();
    const items = await client.getRecentlyAdded({ limit });
    return NextResponse.json({ items });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch recently added');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/recently-added');
