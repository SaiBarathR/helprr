import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';

function parseInt32(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

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
      take: parseInt32(sp.get('take')) ?? 20,
      skip: parseInt32(sp.get('skip')) ?? 0,
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
