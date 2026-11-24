import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { listConnections } from '@/lib/arr-instances';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { coercePositiveInt } from '@/lib/manage-files-guard';
import type { BlocklistItem } from '@/types';

// As many entries of one series as the Activity blocklist lists in all.
const SERIES_BLOCKLIST_WINDOW = 1000;

// A removal must show on the next load, so the list is never cached.
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * An entry rebuilt from what the blocklist row and sheet show. The *arr embeds
 * the whole movie or series (paths, profiles) in every entry; none of it leaves.
 */
function toEntry(raw: BlocklistItem): BlocklistItem {
  const entry: BlocklistItem = { id: raw.id, sourceTitle: raw.sourceTitle, date: raw.date };
  if (typeof raw.protocol === 'string') entry.protocol = raw.protocol;
  if (typeof raw.indexer === 'string') entry.indexer = raw.indexer;
  if (typeof raw.message === 'string') entry.message = raw.message;
  const quality = raw.quality?.quality?.name;
  if (typeof quality === 'string') entry.quality = { quality: { name: quality } };
  return entry;
}

// ── GET /api/activity/blocklist/title ───────────────────────────────────────
// ?source=radarr&movieId= or ?source=sonarr&seriesId=, with the instanceId the
// title belongs to: that title's blocklist, newest first, for its own page.
// Removing goes through DELETE /api/activity/blocklist, as on Activity.
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.view');
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const source = params.get('source');
    if (source !== 'sonarr' && source !== 'radarr') {
      return NextResponse.json({ error: 'source must be "sonarr" or "radarr"' }, { status: 400 });
    }
    const mediaId = coercePositiveInt(params.get(source === 'radarr' ? 'movieId' : 'seriesId'));
    if (!mediaId) {
      return NextResponse.json(
        { error: source === 'radarr' ? 'A valid movieId is required' : 'A valid seriesId is required' },
        { status: 400 },
      );
    }
    // Entry ids are per instance and a removal names one, so the list must come
    // from a named instance, never the default one.
    const instanceId = params.get('instanceId');
    if (!instanceId || instanceId.length > 128) {
      return NextResponse.json({ error: 'instanceId is required' }, { status: 400 });
    }
    const connections = await listConnections(source === 'radarr' ? 'RADARR' : 'SONARR');
    const connection = connections.find((c) => c.id === instanceId);
    if (!connection) {
      return NextResponse.json(
        { error: `Unknown ${source === 'radarr' ? 'Radarr' : 'Sonarr'} instance` },
        { status: 400 },
      );
    }

    let rows: BlocklistItem[];
    let truncated = false;
    if (source === 'radarr') {
      const list = await (await getRadarrClient(instanceId)).getMovieBlocklist(mediaId);
      rows = (Array.isArray(list) ? list : []).filter((row) => row.movieId === mediaId);
    } else {
      const page = await (await getSonarrClient(instanceId)).getSeriesBlocklist(mediaId, SERIES_BLOCKLIST_WINDOW);
      // A Sonarr without the seriesIds filter answers with every series' entries.
      rows = (Array.isArray(page?.records) ? page.records : []).filter((row) => row.seriesId === mediaId);
      truncated = (Number(page?.totalRecords) || 0) > SERIES_BLOCKLIST_WINDOW;
    }

    const records = rows
      .filter((row) => Number.isSafeInteger(row.id) && row.id > 0 && typeof row.sourceTitle === 'string')
      .map((row) => ({ ...toEntry(row), source, instanceId, instanceLabel: connection.label }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return NextResponse.json({ records, truncated }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch the blocklist');
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/blocklist/title');
