import { NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSonarrClient } from '@/lib/service-helpers';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { pollingService } from '@/lib/polling-service';
import { withApiLogging } from '@/lib/api-logger';

// Status for the anime auto-map job. Every Sonarr anime falls in exactly one
// bucket, so mapped + unmatched + neverMapped === total:
//   mapped      — linked (AUTO_MATCH | MANUAL_MATCH)
//   unmatched   — attempted/cleared, no link (AUTO_UNMATCHED | MANUAL_NONE)
//   neverMapped — no mapping row yet (the backlog a run drains)
// `run` carries live progress for the in-flight run, null when idle.
// Admin-only — it reads the Sonarr library.
async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const settings = await getOrCreateAppSettings();
  const { running, run } = pollingService.getAnimeAutoMapState();
  const base = {
    enabled: settings.animeAutoMapEnabled,
    hour: settings.animeAutoMapHour,
    running,
    run,
    lastRunAt: settings.animeAutoMapLastRunAt ? settings.animeAutoMapLastRunAt.toISOString() : null,
  };

  try {
    const client = await getSonarrClient();
    const anime = (await client.getSeries()).filter((s) => s.seriesType === 'anime');
    const rows = await prisma.aniListSeriesMapping.findMany({
      where: { sonarrSeriesId: { in: anime.map((s) => s.id) } },
      select: { sonarrSeriesId: true, state: true },
    });
    const stateById = new Map(rows.map((r) => [r.sonarrSeriesId, r.state]));
    let mapped = 0;
    let unmatched = 0;
    let neverMapped = 0;
    for (const s of anime) {
      const state = stateById.get(s.id);
      if (state === 'AUTO_MATCH' || state === 'MANUAL_MATCH') mapped += 1;
      else if (state === 'AUTO_UNMATCHED' || state === 'MANUAL_NONE') unmatched += 1;
      else neverMapped += 1;
    }

    return NextResponse.json({ ...base, mapped, unmatched, neverMapped, total: anime.length });
  } catch {
    // Sonarr unavailable — counts need the anime library, so they render as
    // "—" rather than misleading DB-wide numbers that include non-anime rows.
    return NextResponse.json({ ...base, mapped: null, unmatched: null, neverMapped: null, total: null });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/automap/status');
