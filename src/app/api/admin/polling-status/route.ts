import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { pollingService } from '@/lib/polling-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Whether background polling runs and how each job last went. Admin-only: job
// errors can name services and hosts.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return NextResponse.json(pollingService.getHealth(), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export const GET = withApiLogging(getHandler, 'api/admin/polling-status', { logBodies: false });
