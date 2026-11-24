import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { readJsonBody } from '@/lib/bulk-editor';
import { parseSeasonPassBody } from '@/lib/series-monitor';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// Apply a Monitoring choice (Future Episodes, First Season, ...) to the episodes of
// one or more series on one instance, through Sonarr's own season pass endpoint.
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('series.editMonitoring');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok) return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    const parsed = parseSeasonPassBody(json.body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // getSonarrClient refuses an id that is not a Sonarr instance before anything is sent.
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    await client.setSeriesMonitoring(parsed.ids, parsed.monitor);
    // A series' monitored flag and episode counts change in the cached library list.
    await invalidateTaggedLibrary('sonarr', instanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to update monitoring');
  }
}

export const POST = withApiLogging(postHandler, 'api/sonarr/seasonpass');
