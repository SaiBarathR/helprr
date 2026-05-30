import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);
    // Scoped to the caller's own Jellyfin user — a member sees their own resume,
    // never the admin's.
    const client = await getJellyfinClientForUser(auth.user);
    const data = await client.getResumeItems({ limit });
    return NextResponse.json({ items: data.Items, linked: true });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ items: [], linked: false });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch resume items';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/resume');
