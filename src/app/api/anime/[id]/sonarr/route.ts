import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { withApiLogging } from '@/lib/api-logger';
import type { AnimeSonarrMappingsResponse, SeriesAniListMappingState } from '@/types/anilist';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid anime ID' }, { status: 400 });
    }

    // Each linked entry points back to its series mapping; a series appears once
    // even if it links several AniList entries (we only filter by this one).
    const entries = await prisma.aniListSeriesMappingEntry.findMany({
      where: { anilistMediaId: id },
      include: { mapping: true },
      orderBy: { mapping: { resolvedAt: 'desc' } },
    });

    const seen = new Set<number>();
    const mappings = [];
    for (const entry of entries) {
      if (seen.has(entry.mapping.sonarrSeriesId)) continue;
      seen.add(entry.mapping.sonarrSeriesId);
      mappings.push({
        sonarrSeriesId: entry.mapping.sonarrSeriesId,
        state: entry.mapping.state as SeriesAniListMappingState,
        seriesTitle: entry.mapping.seriesTitleSnapshot,
        seriesYear: entry.mapping.seriesYearSnapshot,
      });
    }

    return NextResponse.json({ mappings } satisfies AnimeSonarrMappingsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Sonarr mappings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/[id]/sonarr');
