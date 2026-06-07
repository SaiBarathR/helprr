import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { requireAuth, requireCapability } from '@/lib/auth';
import { getSonarrClient } from '@/lib/service-helpers';
import { searchSeriesAniListCandidates } from '@/lib/anilist-series-mapping';
import type { SonarrSeries } from '@/types';
import { withApiLogging } from '@/lib/api-logger';
import { anilistRateLimitResponse } from '@/lib/anilist-http';

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
    const seriesId = Number(id);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
    }

    const client = await getSonarrClient();
    let series: SonarrSeries;
    try {
      series = await client.getSeriesById(seriesId);
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : (error as { statusCode?: number })?.statusCode;
      if (status === 404) {
        return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
      }
      throw error;
    }

    if (!series || series.seriesType !== 'anime') {
      return NextResponse.json({ error: 'Series is not an anime item' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') ?? '';
    const candidates = await searchSeriesAniListCandidates(series, query);

    return NextResponse.json({
      query: query.trim() || series.title,
      items: candidates,
    });
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to search AniList candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]/anime/candidates');
