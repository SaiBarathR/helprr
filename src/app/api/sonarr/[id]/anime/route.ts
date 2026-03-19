import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { requireAuth } from '@/lib/auth';
import { getSonarrClient } from '@/lib/service-helpers';
import {
  clearManualSeriesAniListMapping,
  getSeriesAniListResponse,
  setManualSeriesAniListMapping,
} from '@/lib/anilist-series-mapping';
import type { SonarrSeries } from '@/types';
import type { SeriesAniListResponse } from '@/types/anilist';

interface PutPayload {
  anilistMediaId?: number | string | null;
}

async function getAnimeSeries(id: string) {
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) {
    throw new Error('Invalid series ID');
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
      throw new Error('Invalid series ID');
    }
    throw error;
  }

  if (!series || series.seriesType !== 'anime') {
    throw new Error('Series is not an anime item');
  }

  return series;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const series = await getAnimeSeries(id);
    const response = await getSeriesAniListResponse(series);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load AniList anime details';
    const status = message === 'Invalid series ID' || message === 'Series is not an anime item' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json() as PutPayload;
    const anilistMediaId = Number(body?.anilistMediaId);
    if (!Number.isFinite(anilistMediaId) || anilistMediaId <= 0) {
      return NextResponse.json({ error: 'Invalid AniList media ID' }, { status: 400 });
    }

    const { id } = await params;
    const series = await getAnimeSeries(id);
    const response = await setManualSeriesAniListMapping(series, anilistMediaId);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set AniList mapping';
    const status = message === 'Invalid series ID'
      || message === 'Series is not an anime item'
      || message === 'Only AniList anime series formats can be mapped to Sonarr series.'
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const series = await getAnimeSeries(id);
    const mapping = await clearManualSeriesAniListMapping(series);
    return NextResponse.json({ mapping, detail: null } satisfies SeriesAniListResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear AniList mapping';
    const status = message === 'Invalid series ID' || message === 'Series is not an anime item' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
