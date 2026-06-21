import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import type { MediaManagementConfig } from '@/types';

// Deliberately uncached: this drives the "permanent vs recycle-bin" delete
// warning, so it must reflect the CURRENT *arr config — a stale value could tell
// a user a delete is recoverable when it isn't (or vice versa).
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

// Surfaces just the media-management fields the destructive-confirmation drawer
// needs: whether deletes go to a recycle bin (vs permanent) and whether a delete
// unmonitors the episode. Auth-only, matching the other *arr config routes.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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
    const message =
      error instanceof Error ? error.message : 'Failed to fetch media management config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/config');
