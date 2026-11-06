import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { bumpQueueCacheVersion } from '@/lib/activity-queue';
import { asJsonObject, parseArrId, resolveActivityArrTarget } from '@/lib/activity-arr-target';

// ── POST /api/activity/queue/[id]/grab ──────────────────────────────────────
// Body: { source, instanceId }. Sends a delayed (pending) release to the download
// client now instead of when its delay profile allows.
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const queueId = parseArrId((await params).id);
    if (queueId === null) {
      return NextResponse.json({ error: 'Invalid queue item id' }, { status: 400 });
    }
    const body = asJsonObject(await readJsonBody(request));
    if (!body) return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });

    const resolved = await resolveActivityArrTarget(body.source, body.instanceId);
    if (!resolved.ok) return resolved.response;

    await resolved.target.client.grabQueueItem(queueId);
    await bumpQueueCacheVersion();
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab the release');
  }
}

export const POST = withApiLogging(postHandler, 'api/activity/queue/[id]/grab');
