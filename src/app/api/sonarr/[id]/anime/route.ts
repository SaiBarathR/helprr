import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { requireAuth, requireAdmin, requireCapability } from '@/lib/auth';
import { resolveConnection } from '@/lib/arr-instances';
import { SonarrClient } from '@/lib/sonarr-client';
import {
  addManualEntry,
  clearManualSeriesAniListMapping,
  getSeriesAniListResponse,
  getSeriesEntryDetail,
  removeManualEntry,
  setPrimaryEntry,
} from '@/lib/anilist-series-mapping';
import type { SonarrSeries } from '@/types';
import { withApiLogging } from '@/lib/api-logger';
import { anilistRateLimitResponse } from '@/lib/anilist-http';

async function getAnimeSeries(id: string, instanceId?: string): Promise<{ series: SonarrSeries; sonarrInstanceId: string }> {
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    throw new Error('Invalid series ID');
  }

  // Resolve the connection so the AniList mapping is keyed by this exact instance.
  const connection = await resolveConnection('SONARR', instanceId);
  const client = new SonarrClient(connection.url, connection.apiKey);
  let series: SonarrSeries;
  try {
    series = await client.getSeriesById(seriesId);
  } catch (error) {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : (error as { statusCode?: number })?.statusCode;
    if (status === 404) {
      throw new Error('Invalid series ID');
    }
    throw error;
  }

  if (!series || series.seriesType !== 'anime') {
    throw new Error('Series is not an anime item');
  }

  return { series, sonarrInstanceId: connection.id };
}

function errorStatus(message: string): number {
  return message === 'Invalid series ID'
    || message === 'Series is not an anime item'
    || message === 'Only AniList anime series formats can be mapped to Sonarr series.'
    ? 400
    : 500;
}

// Default scope is 'primary' (lazy page load — one detail). `?detail=<id>`
// fetches a single linked entry on tab select; `?full=1` fetches everything
// (drawer hydration).
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.view');
  if (capError) return capError;

  try {
    const { id } = await params;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const { series, sonarrInstanceId } = await getAnimeSeries(id, instanceId);
    const searchParams = new URL(request.url).searchParams;

    const detailRaw = searchParams.get('detail');
    if (detailRaw != null && detailRaw !== '') {
      const anilistMediaId = Number(detailRaw);
      if (!Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
        return NextResponse.json({ error: 'Invalid AniList media ID' }, { status: 400 });
      }
      const response = await getSeriesEntryDetail(series, sonarrInstanceId, anilistMediaId);
      return NextResponse.json(response);
    }

    const scope = searchParams.get('full') === '1' ? 'all' : 'primary';
    const response = await getSeriesAniListResponse(series, sonarrInstanceId, { scope });
    return NextResponse.json(response);
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to load AniList anime details';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

// Add a manual AniList entry to this series (1 series → N entries). Admin-only
// because AniListSeriesMapping is global/admin state.
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json() as { anilistMediaId?: number | string | null };
    const anilistMediaId = Number(body?.anilistMediaId);
    if (!Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
      return NextResponse.json({ error: 'Invalid AniList media ID' }, { status: 400 });
    }

    const { id } = await params;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const { series, sonarrInstanceId } = await getAnimeSeries(id, instanceId);
    const response = await addManualEntry(series, sonarrInstanceId, anilistMediaId);
    return NextResponse.json(response);
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to add AniList mapping';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

// Set which linked entry is the primary (the default tab). Admin-only.
async function patchHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json() as { primaryId?: number | string | null };
    const primaryId = Number(body?.primaryId);
    if (!Number.isFinite(primaryId) || primaryId <= 0) {
      return NextResponse.json({ error: 'Invalid AniList media ID' }, { status: 400 });
    }

    const { id } = await params;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const { series, sonarrInstanceId } = await getAnimeSeries(id, instanceId);
    const response = await setPrimaryEntry(series, sonarrInstanceId, primaryId);
    return NextResponse.json(response);
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to update primary entry';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

// Remove one linked entry (?anilistMediaId=...) or clear the whole mapping. Admin-only.
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const { series, sonarrInstanceId } = await getAnimeSeries(id, instanceId);
    const raw = new URL(request.url).searchParams.get('anilistMediaId');

    if (raw != null && raw !== '') {
      const anilistMediaId = Number(raw);
      if (!Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
        return NextResponse.json({ error: 'Invalid AniList media ID' }, { status: 400 });
      }
      const response = await removeManualEntry(series, sonarrInstanceId, anilistMediaId);
      return NextResponse.json(response);
    }

    const response = await clearManualSeriesAniListMapping(series, sonarrInstanceId);
    return NextResponse.json(response);
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to clear AniList mapping';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]/anime');
export const POST = withApiLogging(postHandler, 'api/sonarr/[id]/anime');
export const PATCH = withApiLogging(patchHandler, 'api/sonarr/[id]/anime');
export const DELETE = withApiLogging(deleteHandler, 'api/sonarr/[id]/anime');
