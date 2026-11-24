import { NextResponse } from 'next/server';
import { getSonarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { upstreamErrorResponse } from '@/lib/api-error';

// The Series page's Cutoff Unmet filter. A series list item has no cutoff state, so
// it comes from each instance's Wanted → Cutoff Unmet list, read only while the
// filter is on. Cached per instance for as long as the library list (120s).
const CUTOFF_TTL_SECONDS = 120;

const CUTOFF_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache',
  'Vary': 'Cookie',
} as const;

interface CachedCutoff {
  seriesIds: number[];
  complete: boolean;
}

async function getHandler() {
  const auth = await requireUserCapability('series.view');
  if (!auth.ok) return auth.response;

  try {
    const instances = await getSonarrClients();
    const results = await Promise.all(instances.map(async ({ connection, client }) => {
      try {
        const cached = await getCachedJson<CachedCutoff>('sonarr-cutoff-unmet', connection.id);
        if (cached) return { connection, ...cached };
        const fresh = await client.getCutoffUnmetSeriesIds();
        await setCachedJson('sonarr-cutoff-unmet', connection.id, fresh, CUTOFF_TTL_SECONDS);
        return { connection, ...fresh };
      } catch (error) {
        console.error('[api] Sonarr cutoff unmet failed for one instance:', error instanceof Error ? error.message : error);
        return { connection, seriesIds: [], complete: false, failed: true };
      }
    }));
    if (results.length > 0 && results.every((result) => 'failed' in result)) {
      return NextResponse.json({ error: 'No Sonarr instance answered' }, { status: 502 });
    }
    return NextResponse.json({
      // Keyed like the library rows (`${instanceId}:${seriesId}`): series ids repeat across instances.
      series: results.flatMap(({ connection, seriesIds }) => seriesIds.map((id) => `${connection.id}:${id}`)),
      // Instances whose list failed or was cut short, so the page can say the filter missed some.
      incomplete: results.filter((result) => !result.complete).map(({ connection }) => connection.label),
    }, { headers: CUTOFF_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch cutoff unmet series');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/cutoff-unmet');
