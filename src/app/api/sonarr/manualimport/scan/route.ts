import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import { coercePositiveInt } from '@/lib/manage-files-guard';

// ── GET /api/sonarr/manualimport/scan?seriesId=&seasonNumber= ────────────────
// Scans a series folder for importable files (imported + loose) for Manage
// Episodes. The folder is resolved SERVER-SIDE from the series record — a client
// never supplies a path, so this can't be abused to scan arbitrary directories.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.manageFiles');
  if (capError) return capError;

  try {
    const seriesId = coercePositiveInt(request.nextUrl.searchParams.get('seriesId'));
    if (!seriesId) {
      return NextResponse.json({ error: 'A valid seriesId is required' }, { status: 400 });
    }
    const seasonParam = request.nextUrl.searchParams.get('seasonNumber');
    const seasonNumber =
      seasonParam !== null && seasonParam !== '' ? Number(seasonParam) : undefined;
    if (seasonNumber !== undefined && !Number.isInteger(seasonNumber)) {
      return NextResponse.json({ error: 'Invalid seasonNumber' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);

    const series = await client.getSeriesById(seriesId);
    if (!series?.path) {
      return NextResponse.json(
        { error: 'Series folder is not available' },
        { status: 409 }
      );
    }

    const items = await client.scanManualImport({
      folder: series.path,
      seriesId,
      seasonNumber,
      filterExistingFiles: false,
    });
    return NextResponse.json(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan for import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST /api/sonarr/manualimport/scan (reprocess) ──────────────────────────
// Re-runs the import decision engine over edited rows to refresh rejections +
// custom-format score. Non-destructive (no disk changes), so no audit.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.manageFiles');
  if (capError) return capError;

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !Array.isArray(json.body)) {
      return NextResponse.json({ error: 'Expected an array of items' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const items = await client.reprocessManualImport(json.body);
    return NextResponse.json(items);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reprocess import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/manualimport/scan');
export const POST = withApiLogging(postHandler, 'api/sonarr/manualimport/scan');
