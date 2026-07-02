import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQueueCached } from '@/lib/activity-queue';
import { parsePageParams } from '@/lib/pagination';

// no-cache (not max-age): a browser HTTP cache can't be busted by the queue
// version bump on removal, so it would serve a pre-delete body to the reconcile
// refetch and flash removed rows back. The server-side Redis window
// (QUEUE_CACHE_TTL_SECONDS in lib/activity-queue.ts) still collapses poll bursts.
const QUEUE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

// Queue loading + caching + in-flight dedupe live in lib/activity-queue.ts,
// shared with the polling service's cache warmer. The capability gate still
// runs per request before the cache is read.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const { page, pageSize } = parsePageParams(searchParams, { defaultSize: 50, maxSize: 200 });

    const result = await getQueueCached(page, pageSize);
    return NextResponse.json(result, { headers: QUEUE_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/queue');
