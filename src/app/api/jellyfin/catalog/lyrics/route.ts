import { isAxiosError } from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const itemId = new URL(request.url).searchParams.get('itemId') ?? '';
  if (!ITEM_ID_RE.test(itemId)) {
    return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const lyrics = await client.getLyrics(itemId);
    return NextResponse.json({ linked: true, lyrics });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, lyrics: null });
    }
    if (isAxiosError(error) && error.response?.status === 404) {
      return NextResponse.json({ linked: true, lyrics: null });
    }
    return upstreamErrorResponse(error, 'Failed to load lyrics');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/lyrics');
