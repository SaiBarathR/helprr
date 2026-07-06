import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { MediaManagementConfig } from '@/types';

// Deliberately uncached: this drives the "permanent vs recycle-bin" delete
// warning, so it must reflect the CURRENT *arr config — a stale value could tell
// a user a delete is recoverable when it isn't (or vice versa).
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

// Surfaces just the media-management fields the destructive-confirmation drawer
// needs: whether deletes go to a recycle bin (vs permanent) and whether a delete
// unmonitors the episode. Gated on series.manageFiles — the recycle-bin path is a
// server filesystem path, and only the Manage Episodes flow consumes this.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('series.manageFiles');
  if (capError) return capError;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const cfg = await client.getMediaManagementConfig();
    const result: MediaManagementConfig = {
      recycleBin: cfg.recycleBin ?? '',
      recycleBinCleanupDays: cfg.recycleBinCleanupDays,
      autoUnmonitorPreviouslyDownloadedEpisodes:
        cfg.autoUnmonitorPreviouslyDownloadedEpisodes,
      copyUsingHardlinks: cfg.copyUsingHardlinks,
    };
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch media management config');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/config');
