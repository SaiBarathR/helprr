import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import { upstreamErrorResponse } from '@/lib/api-error';
import { activitySourceForbidden } from '@/lib/activity-arr-target';

// One download's files; far above any real pack, and bounds a hostile body.
const MAX_ITEMS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── POST /api/activity/manualimport/reprocess ───────────────────────────────
// Asks the *arr to re-evaluate a download's scanned files after the user gave
// them the series, movie or album the *arr could not match on its own. It answers
// with the season and episodes (or release and tracks) and rejections for that
// choice, as its own manual import dialog does. Non-destructive (no disk changes), so no audit: the import
// itself still goes through POST /api/activity/manualimport.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !isRecord(json.body)) {
      return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
    }
    const { source, items } = json.body;
    if (source !== 'sonarr' && source !== 'radarr' && source !== 'lidarr') {
      return NextResponse.json({ error: 'source is required and must be "sonarr", "radarr" or "lidarr"' }, { status: 400 });
    }
    const forbidden = activitySourceForbidden(auth.user, source);
    if (forbidden) return forbidden;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS || !items.every(isRecord)) {
      return NextResponse.json({ error: `items must be an array of 1 to ${MAX_ITEMS} objects` }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId')
      ?? (typeof json.body.instanceId === 'string' ? json.body.instanceId : undefined);

    const client = source === 'lidarr'
      ? await getLidarrClient(instanceId)
      : source === 'sonarr' ? await getSonarrClient(instanceId) : await getRadarrClient(instanceId);
    return NextResponse.json(await client.reprocessManualImport(items));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to match the files');
  }
}

export const POST = withApiLogging(postHandler, 'api/activity/manualimport/reprocess');
