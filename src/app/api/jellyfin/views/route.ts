import { NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

// The caller's own Jellyfin library views (/Users/{id}/Views) — a member sees
// only the libraries their Jellyfin account has access to.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClientForUser(auth.user);
    const views = await client.getLibraries();
    return NextResponse.json({ views, linked: true });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ views: [], linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch library views';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/views');
