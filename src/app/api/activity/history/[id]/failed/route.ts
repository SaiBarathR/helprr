import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { runWithOperationAudit } from '@/lib/file-audit';
import { bumpQueueCacheVersion } from '@/lib/activity-queue';
import { asJsonObject, parseArrId, resolveActivityArrTarget } from '@/lib/activity-arr-target';

// ── POST /api/activity/history/[id]/failed ──────────────────────────────────
// Body: { source, instanceId }. Marks the download behind a history event failed:
// the *arr blocklists the release and searches for another. Audited.
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const historyId = parseArrId((await params).id);
    if (historyId === null) {
      return NextResponse.json({ error: 'Invalid history event id' }, { status: 400 });
    }
    const body = asJsonObject(await readJsonBody(request));
    if (!body) return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });

    const resolved = await resolveActivityArrTarget(body.source, body.instanceId);
    if (!resolved.ok) return resolved.response;
    const { source, service, appName, instanceId, client } = resolved.target;

    await runWithOperationAudit({
      user: auth.user,
      service,
      instanceId,
      operation: 'MARK_FAILED',
      targetType: 'history',
      targetId: historyId,
      targetTitle: `${appName} history event #${historyId}`,
      itemCount: 1,
      details: { source, historyId },
    }, () => client.markHistoryFailed(historyId));

    // A download still in the queue may change state once the *arr fails it.
    await bumpQueueCacheVersion();
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to mark the download failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/activity/history/[id]/failed');
