import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getSonarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { SonarrClient } from '@/lib/sonarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { SonarrSeries, SonarrSeriesListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

function toListItem(series: SonarrSeries): SonarrSeriesListItem {
  return {
    id: series.id,
    title: series.title,
    sortTitle: series.sortTitle,
    status: series.status,
    overview: series.overview,
    network: series.network,
    images: series.images.filter((img) => img.coverType === 'poster').slice(0, 1),
    year: series.year,
    path: series.path,
    qualityProfileId: series.qualityProfileId,
    monitored: series.monitored,
    runtime: series.runtime,
    genres: series.genres,
    tags: series.tags,
    added: series.added,
    ratings: series.ratings,
    originalLanguage: series.originalLanguage,
    nextAiring: series.nextAiring,
    previousAiring: series.previousAiring,
    statistics: series.statistics,
    seriesType: series.seriesType,
  };
}

async function getHandler(request: NextRequest) {
  const startedAt = performance.now();
  const authError = await requireAuth();
  if (authError) {
    logApiDuration('GET /api/sonarr', startedAt, { method: 'GET', failed: true, authError: true });
    return authError;
  }
  const capError = await requireCapability('series.view');
  if (capError) {
    logApiDuration('GET /api/sonarr', startedAt, { method: 'GET', failed: true, authError: true });
    return capError;
  }

  try {
    const full = request.nextUrl.searchParams.get('full') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;

    const instances = instanceId
      ? await (async () => {
          const conn = await resolveConnection('SONARR', instanceId);
          return [{ connection: conn, client: new SonarrClient(conn.url, conn.apiKey) }];
        })()
      : await getSonarrClients();

    const tagged = (await Promise.all(
      instances.map(async ({ connection, client }) => {
        const series = await client.getSeries();
        return series.map((s) => ({ ...s, instanceId: connection.id, instanceLabel: connection.label }));
      })
    )).flat();

    if (full) {
      logApiDuration('GET /api/sonarr', startedAt, { method: 'GET', full, seriesCount: tagged.length });
      return NextResponse.json(tagged);
    }
    logApiDuration('GET /api/sonarr', startedAt, { method: 'GET', full, seriesCount: tagged.length });
    return NextResponse.json(tagged.map((s) => ({ ...toListItem(s), instanceId: s.instanceId, instanceLabel: s.instanceLabel })));
  } catch (error) {
    logApiDuration('GET /api/sonarr', startedAt, { method: 'GET', failed: true });
    console.error('Failed to fetch series:', error);
    return NextResponse.json({ error: 'Failed to fetch series' }, { status: 500 });
  }
}

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.add');
  if (capError) return capError;

  try {
    const body = await request.json();
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const client = await getSonarrClient(instanceId);
    const result = await client.addSeries(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to add series:', error);
    return NextResponse.json({ error: 'Failed to add series' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr');
export const POST = withApiLogging(postHandler, 'api/sonarr');
