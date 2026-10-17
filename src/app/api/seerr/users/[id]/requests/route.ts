import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';
import { parseSkipTake } from '@/lib/pagination';

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('requests.view');
  if (!auth.ok) return auth.response;

  try {
    const { id: raw } = await params;
    if (!/^\d+$/.test(raw)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    const requestedId = Number.parseInt(raw, 10);
    if (!Number.isFinite(requestedId) || requestedId <= 0) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }
    // Non-admins only ever read their own request list.
    let id = requestedId;
    if (auth.user.role !== 'admin') {
      const own = auth.user.seerrUserId ? Number.parseInt(auth.user.seerrUserId, 10) : NaN;
      if (!Number.isInteger(own)) {
        return NextResponse.json({ results: [], linked: false });
      }
      id = own;
    }
    const sp = request.nextUrl.searchParams;
    const client = await getSeerrClient();
    const data = await client.getUserRequests(id, {
      ...parseSkipTake(sp, { defaultTake: 20, maxTake: 100 }),
    });
    return NextResponse.json(data);
  } catch (error) {
    logger.error(
      'Seerr user requests fetch failed',
      error instanceof Error ? { message: error.message, stack: error.stack } : { error },
      { scope: 'api/seerr/users/[id]/requests' }
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/users/[id]/requests');
