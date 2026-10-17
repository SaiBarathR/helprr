import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';
import { parseSkipTake } from '@/lib/pagination';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Listing Seerr users is request-management (used for approvals + admin linking).
  const auth = await requireUserCapability('requests.approve');
  if (!auth.ok) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const sortRaw = sp.get('sort');
    const sort =
      sortRaw === 'created' || sortRaw === 'updated' || sortRaw === 'requests' || sortRaw === 'displayname'
        ? sortRaw
        : 'displayname';

    const client = await getSeerrClient();
    const data = await client.listUsers({
      ...parseSkipTake(sp, { defaultTake: 100, maxTake: 100 }),
      sort,
    });
    return NextResponse.json(data);
  } catch (error) {
    logger.error(
      'Seerr users fetch failed',
      error instanceof Error ? { message: error.message, stack: error.stack } : { error },
      { scope: 'api/seerr/users' }
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/users');
