import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  const sp = request.nextUrl.searchParams;
  // Clamp pagination: NaN/missing → defaults, non-negative, and cap the limit so
  // a crafted query can't trigger an unbounded upstream fetch.
  const MAX_LIMIT = 100;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit')) || 20));
  const startIndex = Math.max(0, Number(sp.get('startIndex')) || 0);
  const hasUserIdParam = sp.get('hasUserId');
  const hasUserId =
    hasUserIdParam === 'true' ? true : hasUserIdParam === 'false' ? false : undefined;

  try {
    const client = await getJellyfinClient();
    const data = await client.getActivityLog({ limit, startIndex, hasUserId });
    return NextResponse.json({ entries: data.Items, total: data.TotalRecordCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch activity log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/activity');
