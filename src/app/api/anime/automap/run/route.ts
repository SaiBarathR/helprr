import { NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth';
import { pollingService } from '@/lib/polling-service';
import { withApiLogging } from '@/lib/api-logger';

// Run now: start the anime auto-map drain immediately on its dedicated loop
// (one series per minute), bypassing the nightly hour gate. Always 200 — the
// body's { started, reason } says whether a run actually began. Admin-only.
async function postHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const result = await pollingService.startAnimeAutoMapRun('manual');
  return NextResponse.json(result);
}

export const POST = withApiLogging(postHandler, 'api/anime/automap/run');
