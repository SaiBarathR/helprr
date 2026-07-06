import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { readJsonBody } from '@/lib/bulk-editor';
import { coercePositiveInt } from '@/lib/manage-files-guard';
import { upstreamErrorResponse } from '@/lib/api-error';

// ── GET /api/radarr/manualimport/scan?movieId= ──────────────────────────────
// Scans a movie folder for importable files (imported + loose) for Manage Files.
// Passes movieId only (no folder) so Radarr's dedicated "manage files" branch is
// used; the client never supplies a path.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.manageFiles');
  if (capError) return capError;

  try {
    const movieId = coercePositiveInt(request.nextUrl.searchParams.get('movieId'));
    if (!movieId) {
      return NextResponse.json({ error: 'A valid movieId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const items = await client.scanManualImport({ movieId });
    return NextResponse.json(items);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to scan for import');
  }
}

// ── POST /api/radarr/manualimport/scan (reprocess) ──────────────────────────
// Re-runs the import decision engine over edited rows. Non-destructive, no audit.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.manageFiles');
  if (capError) return capError;

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !Array.isArray(json.body)) {
      return NextResponse.json({ error: 'Expected an array of items' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const items = await client.reprocessManualImport(json.body);
    return NextResponse.json(items);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to reprocess import');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/manualimport/scan');
export const POST = withApiLogging(postHandler, 'api/radarr/manualimport/scan');
