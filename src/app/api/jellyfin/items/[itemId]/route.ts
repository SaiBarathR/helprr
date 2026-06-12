import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;

// Single item for the library detail page, scoped to the caller's watch state.
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
    const item = await client.getItem(itemId);
    return NextResponse.json({ item, linked: true });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ item: null, linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch item';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/items/[itemId]');
