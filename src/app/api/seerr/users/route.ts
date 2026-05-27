import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function parseInt32(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const sp = request.nextUrl.searchParams;
    const sortRaw = sp.get('sort');
    const sort =
      sortRaw === 'created' || sortRaw === 'updated' || sortRaw === 'requests' || sortRaw === 'displayname'
        ? sortRaw
        : 'displayname';

    const client = await getSeerrClient();
    const data = await client.listUsers({
      take: parseInt32(sp.get('take')) ?? 100,
      skip: parseInt32(sp.get('skip')) ?? 0,
      sort,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch users';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/users');
