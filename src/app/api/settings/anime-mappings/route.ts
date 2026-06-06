import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import type { AdminAnimeMappingsResponse, SeriesAniListMappingState } from '@/types/anilist';

// List every AniList ↔ Sonarr mapping for the admin settings view. Titles come
// from snapshots stored at link time — zero AniList calls.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const records = await prisma.aniListSeriesMapping.findMany({
    include: { entries: { orderBy: { order: 'asc' } } },
    orderBy: { resolvedAt: 'desc' },
  });

  const response: AdminAnimeMappingsResponse = {
    mappings: records.map((record) => ({
      sonarrSeriesId: record.sonarrSeriesId,
      seriesTitle: record.seriesTitleSnapshot,
      seriesYear: record.seriesYearSnapshot,
      state: record.state as SeriesAniListMappingState,
      matchMethod: record.matchMethod,
      confidence: record.confidence,
      resolvedAt: record.resolvedAt.toISOString(),
      entries: record.entries.map((entry) => ({
        anilistMediaId: entry.anilistMediaId,
        isPrimary: entry.isPrimary,
        order: entry.order,
        source: entry.source === 'auto' ? ('auto' as const) : ('manual' as const),
        titleSnapshot: entry.titleSnapshot,
      })),
    })),
    total: records.length,
  };

  return NextResponse.json(response);
}

// Bulk reset: forget every mapping (entries cascade). Each series re-auto-matches
// — now with season auto-linking — the next time someone views it.
async function deleteHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const result = await prisma.aniListSeriesMapping.deleteMany({});
  return NextResponse.json({ deleted: result.count });
}

export const GET = withApiLogging(getHandler, 'api/settings/anime-mappings');
export const DELETE = withApiLogging(deleteHandler, 'api/settings/anime-mappings');
