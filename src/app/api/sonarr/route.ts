import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { SonarrSeries, SonarrSeriesListItem } from '@/types';

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
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const full = request.nextUrl.searchParams.get('full') === 'true';
    const client = await getSonarrClient();
    const series = await client.getSeries();
    if (full) return NextResponse.json(series);
    return NextResponse.json(series.map(toListItem));
  } catch (error) {
    console.error('Failed to fetch series:', error);
    return NextResponse.json({ error: 'Failed to fetch series' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const client = await getSonarrClient();
    const result = await client.addSeries(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to add series:', error);
    return NextResponse.json({ error: 'Failed to add series' }, { status: 500 });
  }
}
