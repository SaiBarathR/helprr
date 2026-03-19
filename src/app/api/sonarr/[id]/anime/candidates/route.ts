import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSonarrClient } from '@/lib/service-helpers';
import { searchSeriesAniListCandidates } from '@/lib/anilist-series-mapping';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const seriesId = Number(id);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
    }

    const client = await getSonarrClient();
    const series = await client.getSeriesById(seriesId);
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
    const message = error instanceof Error ? error.message : 'Failed to search AniList candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
