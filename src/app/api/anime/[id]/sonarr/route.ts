import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { SonarrClient } from '@/lib/sonarr-client';
import { ensureSeriesAniListMapping } from '@/lib/anilist-series-mapping';
import { withApiLogging } from '@/lib/api-logger';
import type { AnimeSonarrMappingItem, AnimeSonarrMappingsResponse, SeriesAniListMappingState } from '@/types/anilist';

// Each linked entry points back to its series mapping; a series appears once
// even if it links several AniList entries (we only filter by this one).
async function loadMappings(anilistMediaId: number): Promise<AnimeSonarrMappingItem[]> {
  const entries = await prisma.aniListSeriesMappingEntry.findMany({
    where: { anilistMediaId },
    include: { mapping: true },
    orderBy: { mapping: { resolvedAt: 'desc' } },
  });

  // The same series id can exist in two Sonarr instances, so dedupe by instance+id.
  const seen = new Set<string>();
  const mappings: AnimeSonarrMappingItem[] = [];
  for (const entry of entries) {
    const key = `${entry.mapping.sonarrInstanceId}:${entry.mapping.sonarrSeriesId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push({
      sonarrInstanceId: entry.mapping.sonarrInstanceId,
      sonarrSeriesId: entry.mapping.sonarrSeriesId,
      state: entry.mapping.state as SeriesAniListMappingState,
      seriesTitle: entry.mapping.seriesTitleSnapshot,
      seriesYear: entry.mapping.seriesYearSnapshot,
    });
  }
  return mappings;
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('anime.view');
  if (capError) return capError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid anime ID' }, { status: 400 });
    }

    let mappings = await loadMappings(id);

    // Mappings are created lazily when a series page is viewed, so an anime
    // that's in the Sonarr library can read "Not mapped" purely because its
    // series page was never opened. The anime page already knows the matching
    // series (library lookup) and passes it as a hint — resolve it here the
    // same way a series-page visit would. Best-effort: a Sonarr error or an
    // AniList rate limit must not break the read.
    const hintRaw = new URL(request.url).searchParams.get('sonarrSeriesId');
    const hintId = hintRaw != null && hintRaw !== '' ? Number(hintRaw) : null;
    const hintInstanceRaw = new URL(request.url).searchParams.get('sonarrInstanceId');
    const hintInstanceId = hintInstanceRaw && hintInstanceRaw.trim() ? hintInstanceRaw.trim() : undefined;
    if (hintId != null && Number.isFinite(hintId) && hintId > 0) {
      try {
        const connection = await resolveConnection('SONARR', hintInstanceId);
        // A series id is only unique within an instance, so only skip the lazy
        // resolve when THIS instance already has the mapping — a same-numbered
        // series in another instance must not suppress it.
        const alreadyMapped = mappings.some(
          (mapping) => mapping.sonarrInstanceId === connection.id && mapping.sonarrSeriesId === hintId
        );
        if (!alreadyMapped) {
          const client = new SonarrClient(connection.url, connection.apiKey);
          const series = await client.getSeriesById(hintId);
          if (series && series.seriesType === 'anime') {
            await ensureSeriesAniListMapping(series, connection.id);
            mappings = await loadMappings(id);
          }
        }
      } catch {
        // Leave the unhinted result — the row just keeps its current state.
      }
    }

    return NextResponse.json({ mappings } satisfies AnimeSonarrMappingsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Sonarr mappings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/[id]/sonarr');
