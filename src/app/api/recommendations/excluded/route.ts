import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { countExcludedTitles, listExcludedTitles, restoreExcludedTitle } from '@/lib/recommendations/excluded';
import { isItemKey } from '@/lib/recommendations/item-keys';

// The calling user's excluded titles ("Not interested" and dislikes). Every
// read and write is scoped to the authenticated user; there is no user id to
// supply, so nobody can list or restore another user's exclusions.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  // The Recommendations page only needs the count, which skips the lookups.
  if (request.nextUrl.searchParams.get('view') === 'count') {
    return NextResponse.json({ total: await countExcludedTitles(auth.user.id) });
  }
  return NextResponse.json(await listExcludedTitles(auth.user.id));
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const itemKey = body && typeof body === 'object' ? (body as { itemKey?: unknown }).itemKey : undefined;
  if (typeof itemKey !== 'string' || !isItemKey(itemKey)) {
    return NextResponse.json({ error: 'Invalid itemKey' }, { status: 400 });
  }

  const removed = await restoreExcludedTitle(auth.user.id, itemKey);
  return NextResponse.json({ restored: removed > 0 });
}

export const GET = withApiLogging(getHandler, 'api/recommendations/excluded');
export const DELETE = withApiLogging(deleteHandler, 'api/recommendations/excluded');
