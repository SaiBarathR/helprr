import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;

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
    const rawParentId = searchParams.get('parentId');
    if (rawParentId && !ID_PATTERN.test(rawParentId)) {
      return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
    }
    const client = await getJellyfinClient();
    const items = await client.getRecentlyAdded({ limit, parentId: rawParentId ?? undefined });
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch recently added';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/recently-added');
