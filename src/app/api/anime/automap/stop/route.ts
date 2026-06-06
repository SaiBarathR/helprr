import { NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth';
import { pollingService } from '@/lib/polling-service';
import { withApiLogging } from '@/lib/api-logger';

// Stop an in-progress anime auto-map run. Signals the loop, which exits after
// the current item and stamps today done so the scheduled run won't resume
// tonight ("Run now" can restart it). When nothing is running this is a no-op
// — it must NOT stamp, or an idle Stop would suppress tonight's run. Admin-only.
async function postHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const stopping = pollingService.requestAnimeAutoMapStop();
  return NextResponse.json({ ok: true, stopping });
}

export const POST = withApiLogging(postHandler, 'api/anime/automap/stop');
